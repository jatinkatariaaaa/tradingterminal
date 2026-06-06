export function isMarketOpen(category: string): boolean {
  if (category === "crypto") return true // Crypto is open 24/7

  const now = new Date()
  const day = now.getUTCDay() // 0 = Sunday, 1 = Monday, ..., 5 = Friday, 6 = Saturday
  const hour = now.getUTCHours()

  // Forex, Metals, Indices typically close Friday 22:00 UTC and open Sunday 22:00 UTC
  // Friday >= 22:00
  if (day === 5 && hour >= 22) return false
  // All day Saturday
  if (day === 6) return false
  // Sunday < 22:00
  if (day === 0 && hour < 22) return false

  return true
}
