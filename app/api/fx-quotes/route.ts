import { NextResponse } from "next/server"
import { createSupabaseServiceClient } from "@/lib/supabase/service"
import { ASSET_MAP } from "@/lib/trading/assets"
import { freshQuote } from "@/lib/trading/quote-health"
import { isMarketOpenAt } from "@/lib/trading/market-hours"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const symbols = new Set((new URL(request.url).searchParams.get("symbols") ?? "").split(",").map(s => s.trim().toUpperCase()).filter(Boolean))
  try {
    const { data, error } = await createSupabaseServiceClient().from("prices").select("symbol,price,updated_at")
    if (error) throw error
    const now = Date.now()
    const prices: Record<string, number> = {}
    const timestamps: Record<string, number> = {}
    for (const row of data) {
      const asset = ASSET_MAP[row.symbol]
      if (!asset || (symbols.size && !symbols.has(row.symbol))) continue
      const price = Number(row.price)
      const time = Date.parse(row.updated_at)
      if (!Number.isFinite(time) || time > now || !Number.isFinite(price) || price <= 0) continue
      if (isMarketOpenAt(asset.category, now / 1000) && !freshQuote(price, time, now)) continue
      prices[row.symbol] = price
      timestamps[row.symbol] = time
    }
    return NextResponse.json({ prices, timestamps })
  } catch {
    return NextResponse.json({ prices: {}, timestamps: {}, error: "Quote feed unavailable" }, { status: 503 })
  }
}
