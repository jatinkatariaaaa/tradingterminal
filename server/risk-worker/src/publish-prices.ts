// Publish the worker's latest server-observed prices into public.prices so the
// Next.js /api/trade routes can price market orders authoritatively (Option A).
// Upserts every tracked symbol that currently has a price.
// Throttled: only updates each symbol in the Supabase DB once every 5 seconds.

import { supabase } from "./db.js"
import { getPrices } from "./prices.js"
import { ASSET_MAP, isMarketOpen } from "./assets.js"

const lastPublishedTime: Record<string, number> = {}

export async function publishPrices(): Promise<void> {
  const prices = getPrices()
  const now = Date.now()
  const rows: { symbol: string; price: number; updated_at: string }[] = []

  for (const [symbol, price] of Object.entries(prices)) {
    if (!Number.isFinite(price) || price <= 0) continue

    const asset = ASSET_MAP[symbol]
    if (asset && !isMarketOpen(asset.category)) continue

    const lastTime = lastPublishedTime[symbol] ?? 0
    if (now - lastTime >= 5000) {
      rows.push({
        symbol,
        price,
        updated_at: new Date().toISOString(),
      })
      lastPublishedTime[symbol] = now
    }
  }

  if (rows.length === 0) return

  const { error } = await supabase.from("prices").upsert(rows, { onConflict: "symbol" })
  if (error) {
    // Non-fatal: the next tick retries. Log so price staleness is visible.
    console.warn("publishPrices failed:", error.message)
  }
}
