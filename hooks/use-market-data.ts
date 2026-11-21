"use client"

import { useEffect, useState } from "react"
import { ASSET_MAP } from "@/lib/trading/assets"
import { isMarketOpenAt } from "@/lib/trading/market-hours"
import { freshQuote } from "@/lib/trading/quote-health"

interface Quotes {
  prices: Record<string, number>
  timestamps: Record<string, number>
}

/** Worker ticks and the database snapshot share the exchange observation time. */
export function useMarketData(): Quotes {
  const [quotes, setQuotes] = useState<Quotes>({ prices: {}, timestamps: {} })
  useEffect(() => {
    let closed = false
    let dirty = false
    let socket: WebSocket | undefined
    let reconnect: ReturnType<typeof setTimeout>
    const controller = new AbortController()
    const ticks = new Map<string, { price: number; time: number }>()
    function observe(symbol: string, price: number, time: number) {
      const last = ticks.get(symbol)
      if (!Object.hasOwn(ASSET_MAP, symbol) || !Number.isFinite(price) || price <= 0 || !Number.isFinite(time)
        || time <= 0 || time > Date.now() || (last && time <= last.time)) return
      ticks.set(symbol, { price, time })
      dirty = true
    }
    function flush() {
      const now = Date.now()
      for (const [symbol, { price, time }] of ticks) {
        if (isMarketOpenAt(ASSET_MAP[symbol].category, now / 1000) && !freshQuote(price, time, now)) {
          ticks.delete(symbol)
          dirty = true
        }
      }
      if (!dirty || closed) return
      const next: Quotes = { prices: {}, timestamps: {} }
      for (const [symbol, { price, time }] of ticks) {
        next.prices[symbol] = price
        next.timestamps[symbol] = time
      }
      setQuotes(next)
      dirty = false
    }
    let polling = false
    async function poll() {
      if (polling) return
      polling = true
      try {
        const response = await fetch("/api/fx-quotes", { cache: "no-store", signal: controller.signal })
        if (!response.ok || closed) return
        const snapshot = await response.json() as Quotes
        for (const [symbol, price] of Object.entries(snapshot.prices)) observe(symbol, price, snapshot.timestamps[symbol])
        flush()
      } catch { /* Existing observations expire even when polling fails. */ }
      finally { polling = false }
    }
    const url = process.env.NEXT_PUBLIC_WS_URL
    function connect() {
      if (!url || closed) return
      try {
        socket = new WebSocket(url)
        socket.onmessage = ({ data }) => {
          try {
            const tick = JSON.parse(data)
            observe(tick.symbol, tick.price, tick.timestamp)
          } catch { /* Ignore an incomplete frame. */ }
        }
        socket.onclose = () => { if (!closed) reconnect = setTimeout(connect, 3000) }
        socket.onerror = () => socket?.close()
      } catch { /* The HTTP feed continues when the socket is unavailable. */ }
    }
    connect()
    void poll()
    const pollingTimer = setInterval(poll, 10000)
    const flushTimer = setInterval(flush, 150)
    return () => {
      closed = true
      controller.abort()
      clearInterval(flushTimer)
      clearInterval(pollingTimer)
      clearTimeout(reconnect)
      socket?.close()
    }
  }, [])
  return quotes
}
