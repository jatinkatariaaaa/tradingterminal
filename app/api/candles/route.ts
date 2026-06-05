import { NextResponse } from "next/server"
import { getAsset, twelveDataSymbol } from "@/lib/trading/assets"

/**
 * Server-side proxy for REAL historical OHLC candles from Twelve Data.
 *
 * All Twelve Data API calls are proxied and cached here so the frontend never
 * touches it directly, protecting the API key and respecting rate limits.
 *
 * Cache: in-memory Map with 15-minute TTL per symbol+resolution key.
 * Sub-minute timeframes (5s, 15s) return empty — the client builds those live.
 */

const TWELVEDATA_KEY = process.env.TWELVEDATA_API_KEY ?? ""
const BASE_URL = "https://api.twelvedata.com/time_series"

interface Candle {
  time: number // unix seconds
  open: number
  high: number
  low: number
  close: number
}

// --------------- In-memory cache (15 min TTL) ---------------
interface CacheEntry {
  data: Candle[]
  fetchedAt: number
}
const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 15 * 60 * 1000 // 15 minutes

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
): { resolution: string; sourceSeconds: number } | null {
  if (tf < 60) return null // sub-minute — client builds live
  if (tf <= 60) return { resolution: "1min", sourceSeconds: 60 }
  if (tf <= 300) return { resolution: "5min", sourceSeconds: 300 }
  if (tf <= 900) return { resolution: "15min", sourceSeconds: 900 }
  if (tf <= 3600) return { resolution: "1h", sourceSeconds: 3600 }
  if (tf <= 14_400) return { resolution: "4h", sourceSeconds: 14400 }
  if (tf <= 86_400) return { resolution: "1day", sourceSeconds: 86_400 }
  return { resolution: "1week", sourceSeconds: 604_800 }
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

// --------------- Twelve Data fetcher ---------------
async function fetchTwelveDataCandles(
  symbol: string,
  interval: string,
): Promise<Candle[]> {
  const url = `${BASE_URL}?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=1000&timezone=UTC&apikey=${TWELVEDATA_KEY}`

  try {
    const res = await fetch(url, { next: { revalidate: 30 } })
    if (!res.ok) {
      console.warn(`TwelveData ${res.status} for ${symbol}:`, await res.text().catch(() => ""))
      return []
    }
    const json = (await res.json()) as any

    if (json.status === "error" || !json.values) {
      console.warn(`TwelveData error for ${symbol}:`, json.message || "no data")
      return []
    }

    const out: Candle[] = []
    // Twelve Data returns newest first (descending). We need ascending (oldest first).
    for (let i = json.values.length - 1; i >= 0; i--) {
      const v = json.values[i]
      const t = Math.floor(new Date(v.datetime + "Z").getTime() / 1000)
      const o = Number.parseFloat(v.open)
      const h = Number.parseFloat(v.high)
      const l = Number.parseFloat(v.low)
      const c = Number.parseFloat(v.close)
      
      if (Number.isNaN(o) || o <= 0) continue
      out.push({ time: t, open: o, high: h, low: l, close: c })
    }
    return out
  } catch (err) {
    console.warn(`TwelveData fetch error for ${symbol}:`, err)
    return []
  }
}

// --------------- Route handler ---------------
export async function GET(request: Request) {
  const url = new URL(request.url)
  const symbol = (url.searchParams.get("symbol") ?? "").trim().toUpperCase()
  const tf = Number(url.searchParams.get("tf") ?? "60")

  const asset = getAsset(symbol)
  const tdSymbol = twelveDataSymbol(asset)
  if (!tdSymbol || !Number.isFinite(tf) || tf <= 0) {
    return NextResponse.json({ candles: [] as Candle[] })
  }

  const mapped = mapTimeframe(tf)
  if (!mapped) {
    return NextResponse.json({ candles: [] as Candle[] })
  }

  const { resolution, sourceSeconds } = mapped
  const cacheKey = `${tdSymbol}:${resolution}`

  // Check cache first
  let raw = getCached(cacheKey)
  if (!raw) {
    raw = await fetchTwelveDataCandles(tdSymbol, resolution)
    if (raw.length > 0) {
      setCache(cacheKey, raw)
    }
  }

  // Aggregate into target timeframe if needed (e.g., 4h from 1h bars)
  const candles = tf >= sourceSeconds && tf !== sourceSeconds ? aggregate(raw, tf) : raw

  return NextResponse.json({ candles })
}
