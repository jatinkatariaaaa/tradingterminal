"use client"

import { useEffect, useSyncExternalStore } from "react"

export interface SymbolSessionStats {
  /** First price seen this session: the baseline for the change %. */
  open: number
  high: number
  low: number
  /** Rolling buffer of sampled prices for sparklines (about the last 40 samples). */
  series: number[]
}

const SAMPLE_MS = 2000
const MAX_POINTS = 40

/*
 * One shared store for every component that shows session open / high / low:
 * the chart header, the market watch and the quotes screen all read the same
 * numbers. High and low update on every price change so spikes between samples
 * are never missed; the sparkline series and the published snapshot move on a
 * slower cadence so rows re-render at a readable pace.
 */
const stats: Record<string, SymbolSessionStats> = {}
let latest: Record<string, number> = {}
let snapshot: Record<string, SymbolSessionStats> = {}
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null

function ingest(prices: Record<string, number>) {
  latest = prices
  let fresh = false
  for (const [symbol, price] of Object.entries(prices)) {
    if (!Number.isFinite(price)) continue
    const s = stats[symbol]
    if (!s) {
      stats[symbol] = { open: price, high: price, low: price, series: [price] }
      fresh = true
    } else {
      if (price > s.high) s.high = price
      if (price < s.low) s.low = price
    }
  }
  // Publish newly seen symbols right away so first paint has a baseline.
  if (fresh) publish()
}

function publish() {
  snapshot = { ...stats }
  listeners.forEach((l) => l())
}

function sample() {
  for (const [symbol, price] of Object.entries(latest)) {
    if (!Number.isFinite(price)) continue
    const s = stats[symbol]
    if (!s) continue
    s.series = [...s.series, price].slice(-MAX_POINTS)
  }
  publish()
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  if (!timer) timer = setInterval(sample, SAMPLE_MS)
  return () => {
    listeners.delete(fn)
    if (listeners.size === 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }
}

const getSnapshot = () => snapshot
const EMPTY: Record<string, SymbolSessionStats> = {}
const getServerSnapshot = () => EMPTY

export function useSessionStats(prices: Record<string, number>): Record<string, SymbolSessionStats> {
  useEffect(() => {
    ingest(prices)
  }, [prices])
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
