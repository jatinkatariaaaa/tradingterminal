import { supabase } from "./db.js"
import { getFreshQuotes } from "./quotes.js"

const published = new Map<string, number>()
let nextPublish = 0

export async function publishPrices(): Promise<void> {
  const now = Date.now()
  if (now < nextPublish) return
  nextPublish = now + 5000
  const changed = getFreshQuotes(now).filter(([symbol, quote]) => quote.time > (published.get(symbol) ?? 0))
  if (!changed.length) return
  const rows = changed.map(([symbol, quote]) => ({
    symbol, price: quote.price, updated_at: new Date(quote.time).toISOString(),
  }))
  const { error } = await supabase.rpc("publish_terminal_prices", { p_quotes: rows })
  if (error) { console.warn("Price publication failed:", error.message); return }
  for (const [symbol, quote] of changed) published.set(symbol, quote.time)
}
