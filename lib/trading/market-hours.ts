export function isMarketOpen(category: string): boolean {
  return isMarketOpenAt(category, Date.now() / 1000)
}

/**
 * Whether the market for `category` is open at the given epoch time (seconds).
 * Forex/metals/indices close Friday 22:00 UTC and reopen Sunday 22:00 UTC.
 * Used both for live-tick gating and for filtering out weekend buckets when
 * synthesizing fallback history (so charts show a weekend gap like TradingView).
 */
export function isMarketOpenAt(category: string, epochSeconds: number): boolean {
  if (category === "crypto") return true // Crypto is open 24/7

  const d = new Date(epochSeconds * 1000)
  const day = d.getUTCDay() // 0 = Sunday, 1 = Monday, ..., 5 = Friday, 6 = Saturday
  const hour = d.getUTCHours()

  // Friday >= 22:00
  if (day === 5 && hour >= 22) return false
  // All day Saturday
  if (day === 6) return false
  // Sunday < 22:00
  if (day === 0 && hour < 22) return false

  return true
}
