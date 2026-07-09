"use client"

import { memo, useEffect, useMemo, useRef, useState } from "react"
import { Search, Star } from "lucide-react"
import { cn } from "@/lib/utils"
import { ASSETS, CATEGORY_LABELS, bidAsk, formatPrice, spreadOf } from "@/lib/trading/assets"
import type { Asset, AssetCategory, Direction } from "@/lib/trading/types"
import { useMarket, useTradingActions, useTradingState } from "./trading-provider"
import { useWatchlist } from "@/hooks/use-watchlist"
import { useSessionStats, type SymbolSessionStats } from "@/hooks/use-session-stats"
import { Sparkline } from "./watchlist/sparkline"
import { QuoteButton } from "./watchlist/quote-button"

type TabCategory = AssetCategory | "favorites"

const CATEGORIES: TabCategory[] = ["favorites", "forex", "crypto", "commodities"]

/**
 * cTrader-style watchlist row:
 *   SYMBOL          H: … S: … L: …
 *   +chg (+pct%)    [ SELL bid ] [ BUY ask ]
 *   sparkline
 */
const AssetRow = memo(function AssetRow({
  asset,
  price,
  stats,
  active,
  isFav,
  onToggleFav,
  onSelect,
  onQuickTrade,
}: {
  asset: Asset
  price: number
  stats: SymbolSessionStats | undefined
  active: boolean
  isFav: boolean
  onToggleFav: (symbol: string) => void
  onSelect: (symbol: string) => void
  onQuickTrade: (symbol: string, direction: Direction) => void
}) {
  // Tick direction for quote-button flash.
  const prevRef = useRef(price)
  const [dir, setDir] = useState<"up" | "down" | null>(null)
  useEffect(() => {
    if (price > prevRef.current) setDir("up")
    else if (price < prevRef.current) setDir("down")
    prevRef.current = price
    const t = setTimeout(() => setDir(null), 600)
    return () => clearTimeout(t)
  }, [price])

  const spread = spreadOf(asset, price)
  const { bid, ask } = bidAsk(price, spread)
  const open = stats?.open ?? price
  const change = price - open
  const changePct = open !== 0 ? (change / open) * 100 : 0
  const positive = change >= 0
  const spreadPips = spread / Math.pow(10, -asset.digits)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(asset.symbol)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onSelect(asset.symbol)
        }
      }}
      aria-label={`Open ${asset.symbol} chart`}
      className={cn(
        "group @container w-full cursor-pointer rounded-xl border px-2.5 py-2 text-left transition-colors",
        active
          ? "border-ring/50 bg-accent"
          : "border-transparent hover:bg-accent/60",
      )}
    >
      {/* Line 1: fav + symbol …… H / S / L */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onToggleFav(asset.symbol)
            }}
            className={cn(
              "flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition-colors",
              isFav
                ? "text-warning"
                : "text-muted-foreground/30 hover:text-foreground group-hover:text-muted-foreground",
            )}
            aria-label={isFav ? `Remove ${asset.symbol} from watchlist` : `Add ${asset.symbol} to watchlist`}
          >
            <Star className="h-3.5 w-3.5" fill={isFav ? "currentColor" : "none"} />
          </button>
          <span className="shrink-0 whitespace-nowrap text-[13px] font-bold tracking-tight">{asset.symbol}</span>
        </div>
        <div className="flex min-w-0 shrink items-center gap-2 overflow-hidden font-mono text-[10px] tabular-nums text-muted-foreground">
          <span className="hidden truncate @[240px]:inline">H: {formatPrice(stats?.high ?? price, asset.digits)}</span>
          <span className="whitespace-nowrap">S: {spreadPips.toFixed(1)}</span>
          <span className="hidden truncate @[240px]:inline">L: {formatPrice(stats?.low ?? price, asset.digits)}</span>
        </div>
      </div>

      {/* Line 2: change + sparkline …… SELL / BUY */}
      <div className="mt-1 flex items-end justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5 overflow-hidden">
          <span
            className={cn(
              "truncate font-mono text-[11px] font-semibold tabular-nums",
              positive ? "text-profit" : "text-loss",
            )}
          >
            {positive ? "+" : ""}
            {change.toFixed(Math.min(asset.digits, 2))} ({positive ? "+" : ""}
            {changePct.toFixed(2)}%)
          </span>
          {/* Sparkline only when the column has room, so it never slides under the quote buttons */}
          <div className="hidden @[300px]:block">
            <Sparkline data={stats?.series ?? []} positive={positive} />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <QuoteButton
            side="sell"
            price={bid}
            digits={asset.digits}
            flash={dir}
            onClick={(e) => {
              e.stopPropagation()
              onQuickTrade(asset.symbol, "sell")
            }}
          />
          <QuoteButton
            side="buy"
            price={ask}
            digits={asset.digits}
            flash={dir}
            onClick={(e) => {
              e.stopPropagation()
              onQuickTrade(asset.symbol, "buy")
            }}
          />
        </div>
      </div>
    </div>
  )
})

export function AssetPanel() {
  const { activeSymbol } = useTradingState()
  const { prices } = useMarket()
  const { setActiveSymbol, setDraft } = useTradingActions()
  const [category, setCategory] = useState<TabCategory>("favorites")
  const [query, setQuery] = useState("")
  const { isFavorite, toggleFavorite, favorites } = useWatchlist()
  const stats = useSessionStats(prices)

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return ASSETS.filter((a) => {
      if (q) return a.symbol.toLowerCase().includes(q) || a.label.toLowerCase().includes(q)
      if (category === "favorites") return favorites.includes(a.symbol)
      return a.category === category
    })
  }, [category, query, favorites])

  // Automatically switch away from favorites if it's empty to avoid an empty screen initially
  useEffect(() => {
    if (category === "favorites" && favorites.length === 0 && !query) {
      setCategory("forex")
    }
  }, [favorites.length, category, query])

  const quickTrade = (symbol: string, direction: Direction) => {
    setActiveSymbol(symbol)
    setDraft({ direction, type: "market" })
  }

  return (
    <aside className="flex h-full min-h-0 flex-col bg-card">
      {/* Search */}
      <div className="p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search markets…"
            className="w-full rounded-full bg-secondary py-1.5 pl-8 pr-3 text-xs text-secondary-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>

      {/* Category tabs (hidden while searching) */}
      {query.trim() === "" && (
        <div className="flex gap-1 px-2 pb-2">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-full px-1.5 py-1.5 text-[11px] font-semibold transition-colors",
                category === cat
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
              aria-pressed={category === cat}
            >
              {cat === "favorites" ? (
                <Star className="h-3.5 w-3.5" fill="currentColor" />
              ) : (
                CATEGORY_LABELS[cat]
              )}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 space-y-1 overflow-y-auto px-2 pb-2 scrollbar-thin">
        {list.map((asset) => (
          <AssetRow
            key={asset.symbol}
            asset={asset}
            price={prices[asset.symbol] ?? asset.basePrice}
            stats={stats[asset.symbol]}
            active={asset.symbol === activeSymbol}
            isFav={isFavorite(asset.symbol)}
            onToggleFav={toggleFavorite}
            onSelect={setActiveSymbol}
            onQuickTrade={quickTrade}
          />
        ))}
        {list.length === 0 && (
          <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
            {category === "favorites" && !query ? (
              <>
                <Star className="mb-3 h-8 w-8 text-muted" />
                <p className="text-sm font-medium">Watchlist is empty</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Tap the star next to any market to pin it here.
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">No matches found.</p>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
