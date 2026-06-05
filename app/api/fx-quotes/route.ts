import { NextResponse } from "next/server"
import { createSupabaseServiceClient } from "@/lib/supabase/service"

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
      .select("symbol, price")

    if (!error && data) {
      for (const row of data) {
        if (row.price != null) {
          const numPrice = Number(row.price)
          if (Number.isFinite(numPrice) && numPrice > 0) {
            if (requested.length === 0 || requested.includes(row.symbol)) {
              prices[row.symbol] = numPrice
            }
          }
        }
      }
    }
  } catch {
    // Swallow everything — respond with whatever we have.
  }

  return NextResponse.json({ prices })
}
