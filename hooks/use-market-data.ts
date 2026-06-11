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

  // --- Initial Price Sync (Solves Weekend Stale Prices) ---
  // When the WebSocket connects on a weekend, it receives no live updates because markets are closed.
  // This initial fetch ensures the UI immediately displays the last known Friday close price from the DB.
  useEffect(() => {
    let disposed = false
    const pullInitial = async () => {
      try {
        const res = await fetch(`/api/fx-quotes`)
        if (!res.ok) return
        const json = await res.json()
        const fresh = json?.prices ?? {}
        let changed = false
        for (const [symbol, price] of Object.entries(fresh)) {
          if (typeof price !== "number" || !Number.isFinite(price)) continue
          anchorRef.current[symbol] = price
          latestRef.current[symbol] = price
          changed = true
        }
        if (changed) {
          dirtyRef.current = true
          // Force immediate React state override to clear hardcoded fallback values instantly.
          setPrices({ ...latestRef.current })
        }
      } catch {
        // ignore errors
      }
    }
    pullInitial()
    return () => { disposed = true }
  }, [])

  // --- Real, zero-latency WebSocket connection directly to the risk-worker. ---
  useEffect(() => {
    // In production, this should point to your hosted risk-worker's WS URL.
    // Ensure NEXT_PUBLIC_WS_URL is set in Vercel to something like wss://api.yourdomain.com:8080
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8080"
    
    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let disposed = false

    const connect = () => {
      ws = new WebSocket(wsUrl)

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.symbol && typeof data.price === "number") {
            const sym = data.symbol
            const price = data.price
            anchorRef.current[sym] = price
            latestRef.current[sym] = price
            dirtyRef.current = true
          }
        } catch {
          // ignore malformed frames
        }
      }

      ws.onclose = () => {
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



  return { prices, binanceConnected }
}
