import { NextResponse } from "next/server"
import { createSupabaseServiceClient } from "@/lib/supabase/service"
import { ASSETS, twelveDataSymbol } from "@/lib/trading/assets"

export const dynamic = "force-dynamic" // FORCE DYNAMIC: Stop Vercel from caching this API response.


/**
 * Server-side proxy that pulls Forex, metals & energy prices from
 * the public.prices database table (populated by the authorative worker).
 * This ensures the client chart is exactly in sync with the prices the risk
 * engine evaluates and avoids rate limits from Yahoo Finance.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const requested = (url.searchParams.get("symbols") ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)

  const prices: Record<string, number> = {}

  try {
    const supabase = createSupabaseServiceClient()
    const { data, error } = await supabase
      .from("prices")
      .select("symbol, price, updated_at")

    const now = Date.now()
    const staleSymbols: string[] = []
    const reverseMap: Record<string, string> = {} // twelveDataSymbol -> internal symbol

    if (!error && data) {
      for (const row of data) {
        if (row.price != null) {
          const numPrice = Number(row.price)
          if (Number.isFinite(numPrice) && numPrice > 0) {
            // TIMESTAMP LOOPHOLE FIX: If the DB just got re-seeded/re-deployed, its updated_at
            // will be "fresh", but the price is the fake basePrice. We MUST overwrite it.
            // We NO LONGER check time age (stale) because on weekends, prices are frozen anyway,
            // and checking all 15 assets every hour triggers a 429 Rate Limit from Twelve Data.
            const asset = ASSETS.find(a => a.symbol === row.symbol)
            const isSeedValue = asset && numPrice === asset.basePrice

            if (isSeedValue) {
              staleSymbols.push(row.symbol)
            } else {
              if (requested.length === 0 || requested.includes(row.symbol)) {
                prices[row.symbol] = numPrice
              }
            }
          }
        }
      }
    }

    // If we have stale symbols (common on weekends with seeded DB), fetch true close from Twelve Data
    if (staleSymbols.length > 0) {
      // MAX 8 SYMBOLS PER MINUTE to strictly avoid Twelve Data HTTP 429 (Rate Limit) errors!
      const safeBatch = staleSymbols.slice(0, 8)
      
      const tdSymbols = safeBatch
        .map(sym => {
          const asset = ASSETS.find(a => a.symbol === sym)
          if (asset) {
            const tdSym = twelveDataSymbol(asset)
            if (tdSym) {
              reverseMap[tdSym] = sym
              return tdSym
            }
          }
          return null
        })
        .filter(Boolean)

      // SECURITY: never hardcode API keys — must come from env.
      const TWELVEDATA_KEY = process.env.TWELVE_DATA_KEY || process.env.TWELVEDATA_API_KEY
      if (tdSymbols.length > 0 && TWELVEDATA_KEY) {
        const url = `https://api.twelvedata.com/price?symbol=${tdSymbols.join(",")}&apikey=${TWELVEDATA_KEY}`
        const res = await fetch(url)
        if (res.ok) {
          const tdData = await res.json()
          const rowsToUpdate: { symbol: string; price: number; updated_at: string }[] = []
          
          // tdData might be an object mapping symbols to { price: "..." }
          // Or if only 1 symbol, it might be { price: "..." } directly
          if (tdData.price) {
            // Single symbol response
            const firstTdSymbol = tdSymbols[0]
            const sym = firstTdSymbol ? reverseMap[firstTdSymbol] : undefined
            const p = Number.parseFloat(tdData.price)
            if (sym && !Number.isNaN(p)) {
              prices[sym] = p
              rowsToUpdate.push({ symbol: sym, price: p, updated_at: new Date().toISOString() })
            }
          } else {
            // Batch response
            for (const [tdSym, info] of Object.entries(tdData)) {
              const sym = reverseMap[tdSym]
              const p = Number.parseFloat((info as any).price)
              if (sym && !Number.isNaN(p)) {
                prices[sym] = p
                rowsToUpdate.push({ symbol: sym, price: p, updated_at: new Date().toISOString() })
              }
            }
          }

          // Heal the database so we don't fetch again for another hour
          if (rowsToUpdate.length > 0) {
            await supabase.from("prices").upsert(rowsToUpdate, { onConflict: "symbol" })
          }
        }
      }
    }

  } catch {
    // Swallow everything — respond with whatever we have.
  }

  return NextResponse.json({ prices })
}
