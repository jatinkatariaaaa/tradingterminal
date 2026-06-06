import { NextResponse } from "next/server"
import { createSupabaseServiceClient } from "@/lib/supabase/service"
import { ASSETS } from "@/lib/trading/assets"

export const revalidate = 2 // Cache at the Edge for 2 seconds to absorb massive traffic


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
            // Check if stale (older than 1 hour)
            const updatedAt = new Date(row.updated_at).getTime()
            if (now - updatedAt > 60 * 60 * 1000) {
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
      const tdSymbols = staleSymbols
        .map(sym => {
          const asset = ASSETS.find(a => a.symbol === sym)
          if (asset?.twelveDataSymbol) {
            reverseMap[asset.twelveDataSymbol] = sym
            return asset.twelveDataSymbol
          }
          return null
        })
        .filter(Boolean)

      if (tdSymbols.length > 0) {
        const TWELVEDATA_KEY = process.env.TWELVEDATA_API_KEY || ""
        const url = `https://api.twelvedata.com/price?symbol=${tdSymbols.join(",")}&apikey=${TWELVEDATA_KEY}`
        const res = await fetch(url)
        if (res.ok) {
          const tdData = await res.json()
          const rowsToUpdate: { symbol: string; price: number; updated_at: string }[] = []
          
          // tdData might be an object mapping symbols to { price: "..." }
          // Or if only 1 symbol, it might be { price: "..." } directly
          if (tdData.price) {
            // Single symbol response
            const sym = reverseMap[tdSymbols[0]]
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
