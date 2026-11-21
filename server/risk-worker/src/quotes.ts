import { ASSET_MAP, isMarketOpen } from "./assets.js"

export interface Quote { price: number; time: number }
const latest = new Map<string, Quote>()
const maxAge = 120_000

export function recordQuote(symbol: string, price: number, time: number, now = Date.now()) {
  if (!ASSET_MAP[symbol] || !Number.isFinite(price) || price <= 0 || !Number.isFinite(time)
    || time > now || now - time > maxAge || time <= (latest.get(symbol)?.time ?? 0)) return false
  latest.set(symbol, { price, time })
  return true
}

export function getFreshQuotes(now = Date.now()) {
  return [...latest.entries()].filter(([symbol, quote]) => now - quote.time <= maxAge && isMarketOpen(ASSET_MAP[symbol]!.category))
}

export function getPrices(): Record<string, number> {
  return Object.fromEntries(getFreshQuotes().map(([symbol, quote]) => [symbol, quote.price]))
}
