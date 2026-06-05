import { NextResponse } from "next/server"
import { ASSET_MAP } from "@/lib/trading/assets"

/**
 * Server-side proxy for real Forex & metals prices from the massive.com API
 * (Polygon-style). Keeping the request on the server avoids CORS issues and
 * keeps the API key off the client.
 *
 * We use the daily "previous close" aggregate as a real anchor price for each
 * symbol; the client's 500ms simulator then wanders around that anchor so the
 * feed stays live. The route always responds 200 with whatever it could fetch
 * (partial or empty), so the client never sees a "failed to fetch" error.
 *
 * The key defaults to the one provided for out-of-the-box use, but can be
 * overridden with the MASSIVE_API_KEY environment variable.
 */
const API_KEY = process.env.MASSIVE_API_KEY ?? "5DFYO7Rka84GSFBbmPCAa6x7j1G6_oXe"
const BASE = "https://api.massive.com"

// Limit how many upstream requests we fire concurrently to respect free-tier
// rate limits. Successful responses are cached for an hour (daily closes don't
// change intraday), so anchors fill in progressively across polls.
const CONCURRENCY = 4

async function fetchAnchor(ticker: string): Promise<number | null> {
  try {
    const res = await fetch(
      `${BASE}/v2/aggs/ticker/${encodeURIComponent(ticker)}/prev?adjusted=true&apiKey=${API_KEY}`,
      { next: { revalidate: 3600 } },
    )
    if (!res.ok) return null
    const json = (await res.json()) as {
      status?: string
      results?: { c?: number }[]
    }
    const close = json?.results?.[0]?.c
    return typeof close === "number" && Number.isFinite(close) ? close : null
  } catch {
    return null
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await fn(items[index])
    }
  })
  await Promise.all(workers)
  return results
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const requested = (url.searchParams.get("symbols") ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)

  // Resolve to assets that actually use the massive feed and have a ticker.
  const targets = requested
    .map((symbol) => ASSET_MAP[symbol])
    .filter((a): a is NonNullable<typeof a> => !!a && a.feed === "massive" && !!a.massiveTicker)

  const prices: Record<string, number> = {}

  try {
    const anchors = await mapWithConcurrency(targets, CONCURRENCY, async (asset) => ({
      symbol: asset.symbol,
      price: await fetchAnchor(asset.massiveTicker as string),
    }))
    for (const { symbol, price } of anchors) {
      if (price != null) prices[symbol] = price
    }
  } catch {
    // Swallow everything — respond with whatever we have.
  }

  return NextResponse.json({ prices })
}
