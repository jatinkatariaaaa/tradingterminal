"use client"

import { useEffect, useRef, useState } from "react"

export interface SymbolSessionStats {
  /** First price seen this session — baseline for day-change %. */
  open: number
  high: number
  low: number
  /** Rolling buffer of sampled prices for the sparkline (~last 40 samples). */
  series: number[]
}

const SAMPLE_MS = 2000
const MAX_POINTS = 40

/**
 * Derives per-symbol session stats (open / high / low / sparkline series)
 * from the live mid-price stream. Sampled on an interval so the sparkline
 * moves at a readable pace instead of every tick, and stats survive symbol
 * switches because everything is keyed by symbol in one ref map.
 */
export function useSessionStats(prices: Record<string, number>): Record<string, SymbolSessionStats> {
  const statsRef = useRef<Record<string, SymbolSessionStats>>({})
  const pricesRef = useRef(prices)
  pricesRef.current = prices
  const [snapshot, setSnapshot] = useState<Record<string, SymbolSessionStats>>({})

  // High/low must not miss spikes between samples — update them on every price change.
  useEffect(() => {
    const stats = statsRef.current
    for (const [symbol, price] of Object.entries(prices)) {
      if (!Number.isFinite(price)) continue
      const s = stats[symbol]
      if (!s) {
        stats[symbol] = { open: price, high: price, low: price, series: [price] }
      } else {
        if (price > s.high) s.high = price
        if (price < s.low) s.low = price
      }
    }
  }, [prices])

  // Sparkline sampling + published snapshot on a slow cadence.
  useEffect(() => {
    const id = setInterval(() => {
      const stats = statsRef.current
      for (const [symbol, price] of Object.entries(pricesRef.current)) {
        if (!Number.isFinite(price)) continue
        const s = stats[symbol]
        if (!s) continue
        s.series.push(price)
        if (s.series.length > MAX_POINTS) s.series.shift()
      }
      // Shallow-copy so React sees a new object; inner objects are stable refs
      // but rows re-read .series length/values on each snapshot.
      setSnapshot({ ...stats })
    }, SAMPLE_MS)
    return () => clearInterval(id)
  }, [])

  return snapshot
}
