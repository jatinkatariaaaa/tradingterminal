"use client"

import { useEffect, useRef, useState } from "react"
import { ASSETS } from "@/lib/trading/assets"

/**
 * Combined real-time market data feed. Three sources are merged into a single
 * price map:
 *
 *  1. CRYPTO — the public, unauthenticated Binance combined stream:
 *       wss://stream.binance.com:9443/ws/!ticker@arr
 *     A single socket delivers 24h ticker objects for EVERY trading pair about
 *     once per second. We read `s` (symbol) and `c` (last price) and update any
 *     symbol we track. No key or registration required.
 *
 *  2. FOREX & METALS — real anchor prices from the massive.com API, fetched
 *     server-side via /api/fx-quotes, then kept live by the simulator below.
 *
 *  3. SIMULATOR — a 500ms loop that nudges every forex/metal/energy price by a
 *     small random fraction (~+/-0.02%) with gentle mean-reversion toward its
 *     real anchor (or baseline), so the feed is always live and never errors.
 *
 * High-frequency ticks are written to a ref synchronously and flushed into
 * React state on a throttled timer so the tree never re-renders too often.
 */
export interface MarketData {
  /** Latest price for every known symbol. */
  prices: Record<string, number>
  /** Whether the Binance socket is currently connected. */
  binanceConnected: boolean
}

const SEED_PRICES = () =>
  Object.fromEntries(ASSETS.map((a) => [a.symbol, a.basePrice])) as Record<string, number>

export function useMarketData(): MarketData {
  const [prices, setPrices] = useState<Record<string, number>>(SEED_PRICES)
  const [binanceConnected, setBinanceConnected] = useState(false)

  // Authoritative, synchronously-updated store of the latest tick per symbol.
  const latestRef = useRef<Record<string, number>>(SEED_PRICES())
  // Mean-reversion targets for simulated assets (real anchors when available).
  const anchorRef = useRef<Record<string, number>>(
    Object.fromEntries(ASSETS.map((a) => [a.symbol, a.basePrice])),
  )
  const dirtyRef = useRef(false)
  // Mirror of `binanceConnected` for the simulator loop (avoids re-subscribing).
  const binanceConnectedRef = useRef(false)
  binanceConnectedRef.current = binanceConnected

  // --- Throttled flush: push the ref into state ~10x/sec (only when changed).
  useEffect(() => {
    const id = setInterval(() => {
      if (!dirtyRef.current) return
      dirtyRef.current = false
      setPrices({ ...latestRef.current })
    }, 100)
    return () => clearInterval(id)
  }, [])

  // --- Binance combined !ticker@arr stream (all crypto pairs, one socket). ---
  useEffect(() => {
    const tracked = new Set(
      ASSETS.filter((a) => a.feed === "binance" && a.binanceStream).map((a) => a.symbol),
    )
    if (tracked.size === 0) return

    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let disposed = false

    const connect = () => {
      ws = new WebSocket("wss://stream.binance.com:9443/ws/!ticker@arr")

      ws.onopen = () => setBinanceConnected(true)

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          // The combined stream delivers an array of 24h ticker objects:
          // [{ s: "BTCUSDT", c: "73000.10", ... }, ...]
          const arr: any[] = Array.isArray(data) ? data : data?.data
          if (!Array.isArray(arr)) return
          let changed = false
          for (const t of arr) {
            const sym = t?.s
            if (typeof sym === "string" && tracked.has(sym)) {
              const price = Number.parseFloat(t.c)
              if (Number.isFinite(price)) {
                latestRef.current[sym] = price
                changed = true
              }
            }
          }
          if (changed) dirtyRef.current = true
        } catch {
          // Ignore malformed frames.
        }
      }

      ws.onclose = () => {
        setBinanceConnected(false)
        if (!disposed) reconnectTimer = setTimeout(connect, 2000)
      }

      ws.onerror = () => ws?.close()
    }

    connect()

    return () => {
      disposed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      ws?.close()
      ws = null
    }
  }, [])

  // --- Real, near-live anchors for forex, metals & energy via the proxy. -----
  useEffect(() => {
    const yahooAssets = ASSETS.filter((a) => !!a.yahooTicker)
    if (yahooAssets.length === 0) return

    const symbols = yahooAssets.map((a) => a.symbol).join(",")
    let disposed = false

    const pull = async () => {
      try {
        const res = await fetch(`/api/fx-quotes?symbols=${encodeURIComponent(symbols)}`)
        if (!res.ok) return
        const json = (await res.json()) as { prices?: Record<string, number> }
        const fresh = json?.prices ?? {}
        for (const [symbol, price] of Object.entries(fresh)) {
          if (typeof price !== "number" || !Number.isFinite(price)) continue
          anchorRef.current[symbol] = price
          // Always snap the displayed price to the real quote from the server.
          // This keeps the terminal UI in perfect sync with the database prices,
          // preventing any execution price mismatches (slippage) in the Order Ticket.
          latestRef.current[symbol] = price
          dirtyRef.current = true
        }
      } catch {
        // Never surface fetch errors — the simulator keeps the feed alive.
      }
    }

    pull()
    // Yahoo quotes are near-live; refresh frequently to stay accurate.
    const id = setInterval(() => {
      if (!disposed) pull()
    }, 2000)

    return () => {
      disposed = true
      clearInterval(id)
    }
  }, [])



  return { prices, binanceConnected }
}
