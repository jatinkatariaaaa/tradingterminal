import { ASSETS } from "./assets"
import { isMarketOpenAt } from "./market-hours"

export const QUOTE_MAX_AGE_MS = 120_000

export function freshQuote(price: number, observedAt: number, now: number) {
  return Number.isFinite(price) && price > 0 && observedAt > 0 && observedAt <= now && now - observedAt <= QUOTE_MAX_AGE_MS
}

export interface PriceRow { symbol: string; price: number | string; updated_at: string }

export function summarizeFeed(rows: PriceRow[], now = Date.now()) {
  const bySymbol = new Map(rows.map(row => [row.symbol, row]))
  const expected = ASSETS.filter(asset => isMarketOpenAt(asset.category, now / 1000))
  const staleSymbols: string[] = []
  let newest = 0
  for (const asset of expected) {
    const row = bySymbol.get(asset.symbol)
    const at = row ? Date.parse(row.updated_at) : NaN
    if (Number.isFinite(at) && at <= now) newest = Math.max(newest, at)
    if (!row || !freshQuote(Number(row.price), at, now)) staleSymbols.push(asset.symbol)
  }
  const count = expected.length - staleSymbols.length
  return {
    ok: staleSymbols.length === 0, service: "tpp-terminal",
    priceFeed: !staleSymbols.length ? "live" : count > 0 ? "degraded" : newest ? "stale" : "no prices",
    lastPriceAgeSeconds: newest ? Math.floor((now - newest) / 1000) : null,
    expectedSymbols: expected.length, freshSymbols: count, staleSymbols,
  }
}
