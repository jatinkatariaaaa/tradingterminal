"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Activity, Search, Star } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  ASSETS,
  CATEGORY_LABELS,
  bidAsk,
  formatMoney,
  formatPrice,
  getAsset,
  spreadOf,
} from "@/lib/trading/assets"
import type { Asset, AssetCategory, Direction } from "@/lib/trading/types"
import { useMarket } from "./trading-provider"
import { useWatchlist } from "@/hooks/use-watchlist"

type TabCategory = AssetCategory | "favorites"
const CATEGORIES: TabCategory[] = ["favorites", "forex", "crypto", "commodities"]

/** Render a price with its final digit shrunk — the cTrader "pip" style. */
function PipPrice({ value, digits, className }: { value: number; digits: number; className?: string }) {
  const s = formatPrice(value, digits)
  const main = s.slice(0, -1)
  const last = s.slice(-1)
  return (
    <span className={cn("font-mono tabular-nums", className)}>
      {main}
      <span className="text-[0.72em] align-top">{last}</span>
    </span>
  )
}

/** Tiny inline sparkline drawn from a rolling buffer of recent prices. */
function Sparkline({ points, up }: { points: number[]; up: boolean }) {
  const W = 96
  const H = 36
  if (points.length < 2) {
    return <svg width={W} height={H} className="block" aria-hidden="true" />
  }
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const stepX = W / (points.length - 1)
  const coords = points.map((p, i) => {
    const x = i * stepX
    const y = H - ((p - min) / span) * (H - 4) - 2
    return [x, y] as const
  })
  const line = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")
  const area = `${line} ${W},${H} 0,${H}`
  const color = up ? "var(--profit)" : "var(--loss)"
  const gid = up ? "spark-up" : "spark-down"
  return (
    <svg width={W} height={H} className="block" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gid})`} />
      <polyline points={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function AssetCard({
  asset,
  isFav,
  onToggleFav,
  onOpenChart,
}: {
  asset: Asset
  isFav: boolean
  onToggleFav: (symbol: string) => void
  onOpenChart: (symbol: string, direction?: Direction) => void
}) {
  const { prices } = useMarket()
  const price = prices[asset.symbol] ?? asset.basePrice

  // Rolling buffer (built while the watchlist is open) powers the sparkline,
  // the session change %, and the session high/low — all live and honest.
  const bufRef = useRef<number[]>([])
  const [, force] = useState(0)
  useEffect(() => {
    if (!Number.isFinite(price) || price <= 0) return
    const buf = bufRef.current
    if (buf.length === 0 || buf[buf.length - 1] !== price) {
      buf.push(price)
      if (buf.length > 40) buf.shift()
      force((n) => n + 1)
    }
  }, [price])

  const buf = bufRef.current
  const ref = buf.length > 0 ? buf[0] : price
  const change = price - ref
  const changePct = ref ? (change / ref) * 100 : 0
  const up = change >= 0
  const sessionHigh = buf.length > 0 ? Math.max(...buf) : price
  const sessionLow = buf.length > 0 ? Math.min(...buf) : price

  const spread = spreadOf(asset, price)
  const { bid, ask } = bidAsk(price, spread)
  // Spread expressed in points (pips) for the H/S/L row.
  const pip = asset.category === "forex" ? Math.pow(10, -(asset.digits - 1)) : Math.pow(10, -asset.digits)
  const spreadPts = spread / pip

  return (
    <div className="border-b border-border bg-card">
      {/* Top: identity + change + sparkline (tap opens chart) */}
      <button
        type="button"
        onClick={() => onOpenChart(asset.symbol)}
        className="flex w-full items-center gap-3 px-3 pt-3 text-left"
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onToggleFav(asset.symbol)
          }}
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors",
            isFav ? "text-[var(--warning)]" : "text-muted-foreground/40 hover:text-foreground",
          )}
          aria-label={isFav ? "Remove from watchlist" : "Add to watchlist"}
        >
          <Star className="h-4 w-4" fill={isFav ? "currentColor" : "none"} />
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-bold tracking-tight">{asset.symbol}</span>
            <span className="truncate text-[11px] text-muted-foreground">{asset.label}</span>
          </div>
          <div
            className="mt-0.5 text-xs font-semibold tabular-nums"
            style={{ color: up ? "var(--profit)" : "var(--loss)" }}
          >
            {up ? "+" : ""}
            {change.toFixed(asset.digits)} ({up ? "+" : ""}
            {changePct.toFixed(2)}%)
          </div>
        </div>

        <Sparkline points={buf} up={up} />
      </button>

      {/* H / S / L row */}
      <div className="flex items-center gap-4 px-3 pt-2 text-[10px] text-muted-foreground">
        <span>
          H: <span className="font-mono tabular-nums text-foreground/70">{formatPrice(sessionHigh, asset.digits)}</span>
        </span>
        <span>
          S: <span className="font-mono tabular-nums text-foreground/70">{spreadPts.toFixed(1)}</span>
        </span>
        <span>
          L: <span className="font-mono tabular-nums text-foreground/70">{formatPrice(sessionLow, asset.digits)}</span>
        </span>
      </div>

      {/* SELL / BUY quote buttons */}
      <div className="grid grid-cols-2 gap-2 p-3 pt-2">
        <button
          type="button"
          onClick={() => onOpenChart(asset.symbol, "sell")}
          className="flex flex-col items-center rounded-lg border py-2 transition-colors active:scale-[0.98]"
          style={{ borderColor: "var(--sell)", color: "var(--sell)" }}
        >
          <span className="text-[10px] font-bold uppercase tracking-wider">Sell</span>
          <PipPrice value={bid} digits={asset.digits} className="text-base font-bold" />
        </button>
        <button
          type="button"
          onClick={() => onOpenChart(asset.symbol, "buy")}
          className="flex flex-col items-center rounded-lg border py-2 transition-colors active:scale-[0.98]"
          style={{ borderColor: "var(--buy)", color: "var(--buy)" }}
        >
          <span className="text-[10px] font-bold uppercase tracking-wider">Buy</span>
          <PipPrice value={ask} digits={asset.digits} className="text-base font-bold" />
        </button>
      </div>
    </div>
  )
}

export function MobileWatchlist({
  balance,
  onOpenChart,
}: {
  balance: number
  onOpenChart: (symbol: string, direction?: Direction) => void
}) {
  const [category, setCategory] = useState<TabCategory>("favorites")
  const [query, setQuery] = useState("")
  const { isFavorite, toggleFavorite, favorites } = useWatchlist()

  const counts = useMemo(() => {
    const c: Record<AssetCategory, number> = { forex: 0, crypto: 0, commodities: 0 }
    for (const a of ASSETS) c[a.category]++
    return c
  }, [])

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return ASSETS.filter((a) => {
      if (q) return a.symbol.toLowerCase().includes(q) || a.label.toLowerCase().includes(q)
      if (category === "favorites") return favorites.includes(a.symbol)
      return a.category === category
    })
  }, [category, query, favorites])

  useEffect(() => {
    if (category === "favorites" && favorites.length === 0 && !query) {
      setCategory("forex")
    }
  }, [favorites.length, category, query])

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* Header: brand + balance pill */}
      <header className="flex items-center gap-2 border-b border-border bg-card px-3 pt-[max(env(safe-area-inset-top),0.5rem)] pb-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Activity className="h-4.5 w-4.5" />
        </div>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="w-full rounded-full bg-secondary py-2 pl-8 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div className="rounded-full bg-secondary px-3 py-2 font-mono text-sm font-semibold tabular-nums">
          {formatMoney(balance)}
        </div>
      </header>

      {/* Category chips */}
      <div className="flex items-center gap-2 overflow-x-auto border-b border-border bg-card px-3 py-2 scrollbar-none">
        {CATEGORIES.map((cat) => {
          const active = category === cat
          return (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className={cn(
                "flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                active ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground",
              )}
            >
              {cat === "favorites" ? (
                <>
                  <Star className="h-3.5 w-3.5" fill="currentColor" />
                  Watchlist
                </>
              ) : (
                <>
                  {CATEGORY_LABELS[cat]}
                  <span className="opacity-60">{counts[cat]}</span>
                </>
              )}
            </button>
          )
        })}
      </div>

      {/* Section label */}
      <div className="flex items-center justify-between border-b border-border bg-background px-3 py-2">
        <h2 className="text-sm font-bold">
          {query.trim() ? "Search results" : category === "favorites" ? "My watchlist" : `${CATEGORY_LABELS[category as AssetCategory]} markets`}
        </h2>
        <span className="text-xs text-muted-foreground">{list.length} symbols</span>
      </div>

      {/* Cards */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {list.map((asset) => (
          <AssetCard
            key={asset.symbol}
            asset={asset}
            isFav={isFavorite(asset.symbol)}
            onToggleFav={toggleFavorite}
            onOpenChart={onOpenChart}
          />
        ))}
        {list.length === 0 && (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <Star className="mb-3 h-8 w-8 text-muted" />
            <p className="text-sm font-medium">
              {category === "favorites" && !query ? "Your watchlist is empty" : "No matches found"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {category === "favorites" && !query
                ? "Tap the star on any symbol to pin it here."
                : "Try a different symbol or category."}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
