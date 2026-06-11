import { NextResponse } from "next/server"
import { getAsset, yahooChartTicker } from "@/lib/trading/assets"

/**
 * Server-side proxy for REAL historical OHLC candles from Yahoo Finance.
 *
 * Yahoo Finance is used because it provides free historical data for
 * Forex and Commodities (unlike TwelveData which blocks Silver, Oil, etc. on free tier).
 *
 * Cache: in-memory Map with 1-minute TTL per symbol+resolution key.
 * Sub-minute timeframes (5s, 15s) return empty — the client builds those live.
 */

const BASE_URL = "https://query1.finance.yahoo.com/v8/finance/chart"

interface Candle {
  time: number // unix seconds
  open: number
  high: number
  low: number
  close: number
}

// --------------- In-memory cache (1 min TTL) ---------------
interface CacheEntry {
  data: Candle[]
  fetchedAt: number
}
const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 60 * 1000 // 1 minute

function getCached(key: string): Candle[] | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    cache.delete(key)
    return null
  }
  return entry.data
}

function setCache(key: string, data: Candle[]): void {
  cache.set(key, { data, fetchedAt: Date.now() })
}

// --------------- Resolution mapping ---------------
function mapTimeframe(
  tf: number,
): { interval: string; range: string; sourceSeconds: number } | null {
  if (tf < 60) return null // sub-minute — client builds live
  if (tf <= 60) return { interval: "1m", range: "7d", sourceSeconds: 60 }
  if (tf <= 300) return { interval: "5m", range: "60d", sourceSeconds: 300 }
  if (tf <= 900) return { interval: "15m", range: "60d", sourceSeconds: 900 }
  if (tf <= 3600) return { interval: "60m", range: "730d", sourceSeconds: 3600 }
  if (tf <= 14_400) return { interval: "60m", range: "730d", sourceSeconds: 3600 } // Fetch 1h and aggregate to 4h
  if (tf <= 86_400) return { interval: "1d", range: "10y", sourceSeconds: 86_400 }
  return { interval: "1wk", range: "10y", sourceSeconds: 604_800 }
}

// --------------- Aggregation ---------------
function aggregate(raw: Candle[], tf: number): Candle[] {
  const buckets = new Map<number, Candle>()
  for (const bar of raw) {
    const key = Math.floor(bar.time / tf) * tf
    const existing = buckets.get(key)
    if (!existing) {
      buckets.set(key, { ...bar, time: key })
    } else {
      existing.high = Math.max(existing.high, bar.high)
      existing.low = Math.min(existing.low, bar.low)
      existing.close = bar.close
    }
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time)
}

// --------------- Yahoo Finance fetcher ---------------
async function fetchYahooCandles(
  symbol: string,
  interval: string,
  range: string
): Promise<Candle[]> {
  const url = `${BASE_URL}/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`

  try {
    const res = await fetch(url, { next: { revalidate: 30 } })
    if (!res.ok) {
      console.warn(`Yahoo ${res.status} for ${symbol}:`, await res.text().catch(() => ""))
      return []
    }
    const json = (await res.json()) as any

    const result = json?.chart?.result?.[0]
    if (!result || !result.timestamp || !result.indicators?.quote?.[0]) {
      console.warn(`Yahoo error for ${symbol}: no data`)
      return []
    }

    const timestamps = result.timestamp as number[]
    const quote = result.indicators.quote[0]
    
    const out: Candle[] = []
    
    for (let i = 0; i < timestamps.length; i++) {
      const t = timestamps[i]
      const o = quote.open[i]
      const h = quote.high[i]
      const l = quote.low[i]
      const c = quote.close[i]
      
      // Yahoo sometimes has null values for thin trading periods
      if (o == null || h == null || l == null || c == null) continue
      if (Number.isNaN(o) || o <= 0) continue
      
      out.push({ time: t, open: o, high: h, low: l, close: c })
    }
    return out
  } catch (err) {
    console.warn(`Yahoo fetch error for ${symbol}:`, err)
    return []
  }
}

// --------------- Route handler ---------------
export async function GET(request: Request) {
  const url = new URL(request.url)
  const symbol = (url.searchParams.get("symbol") ?? "").trim().toUpperCase()
  const tf = Number(url.searchParams.get("tf") ?? "60")

  const asset = getAsset(symbol)
  const chartSymbol = yahooChartTicker(asset)
  if (!chartSymbol || !Number.isFinite(tf) || tf <= 0) {
    return NextResponse.json({ candles: [] as Candle[] })
  }

  const mapped = mapTimeframe(tf)
  if (!mapped) {
    return NextResponse.json({ candles: [] as Candle[] })
  }

  const { interval, range, sourceSeconds } = mapped
  const cacheKey = `${chartSymbol}:${interval}`

  // Check cache first
  let raw = getCached(cacheKey)
  if (!raw) {
    raw = await fetchYahooCandles(chartSymbol, interval, range)
    if (raw.length > 0) {
      setCache(cacheKey, raw)
    }
  }

  // Aggregate into target timeframe if needed (e.g., 4h from 1h bars)
  const candles = tf >= sourceSeconds && tf !== sourceSeconds ? aggregate(raw, tf) : raw

  return NextResponse.json({ candles })
}
