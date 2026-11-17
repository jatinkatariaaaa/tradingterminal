"use client"

import { memo, useMemo, useState } from "react"
import { Search, Star } from "lucide-react"
import { cn } from "@/lib/utils"
import { ASSETS, bidAsk, formatPrice, getAsset, spreadOf } from "@/lib/trading/assets"
import { isMarketOpen } from "@/lib/trading/market-hours"
import type { Asset, Direction } from "@/lib/trading/types"
import { useSessionStats, type SymbolSessionStats } from "@/hooks/use-session-stats"
import { useWatchlist } from "@/hooks/use-watchlist"
import { useMarket, useTradingActions, useTradingState } from "./trading-provider"
import { Sparkline } from "./watchlist/sparkline"
import { useTick } from "./kit"

type Cat = "favorites" | "all" | "forex" | "commodities" | "crypto"

const CATS: { key: Cat; label: string }[] = [
  { key: "all", label: "All" },
  { key: "forex", label: "FX" },
  { key: "commodities", label: "Metals" },
  { key: "crypto", label: "Crypto" },
  { key: "favorites", label: "★" },
]

const Row = memo(function Row({
  asset,
  price,
  stats,
  active,
  fav,
  onSelect,
  onTrade,
  onFav,
}: {
  asset: Asset
  price: number
  stats: SymbolSessionStats | undefined
  active: boolean
  fav: boolean
  onSelect: (s: string) => void
  onTrade: (s: string, d: Direction) => void
  onFav: (s: string) => void
}) {
  const tick = useTick(price)
  const spread = spreadOf(asset, price)
  const { bid, ask } = bidAsk(price, spread)
  const open = stats?.open ?? price
  const chg = open ? ((price - open) / open) * 100 : 0
  const closed = !isMarketOpen(asset.category)
  const tone = tick === "up" ? "text-buy" : tick === "down" ? "text-sell" : ""

  return (
    <tr
      onClick={() => onSelect(asset.symbol)}
      className={cn("group h-8 cursor-pointer border-b border-border/50 transition-colors", active ? "bg-accent" : "hover:bg-accent/50")}
      aria-selected={active}
    >
      <td className="pl-2">
        <span className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onFav(asset.symbol)
            }}
            aria-label={fav ? `Unpin ${asset.symbol}` : `Pin ${asset.symbol}`}
            className={cn("shrink-0", fav ? "text-warning" : "text-muted-foreground/30 group-hover:text-muted-foreground")}
          >
            <Star className="h-3 w-3" fill={fav ? "currentColor" : "none"} />
          </button>
          <span className={cn("text-[12.5px] font-semibold tracking-tight", closed && "text-muted-foreground")}>{asset.symbol}</span>
        </span>
      </td>
      <td className="px-0.5 text-right">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onTrade(asset.symbol, "sell")
          }}
          title={`Sell ${asset.symbol}`}
          className={cn("rounded px-1 font-mono text-[12px] tabular-nums transition-colors hover:bg-sell/15", tone)}
        >
          {formatPrice(bid, asset.digits)}
        </button>
      </td>
      <td className="pr-2 pl-0.5 text-right @[320px]:pr-0.5">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onTrade(asset.symbol, "buy")
          }}
          title={`Buy ${asset.symbol}`}
          className={cn("rounded px-1 font-mono text-[12px] tabular-nums transition-colors hover:bg-buy/15", tone)}
        >
          {formatPrice(ask, asset.digits)}
        </button>
      </td>
      <td className={cn("hidden pr-2 text-right font-mono text-[11px] tabular-nums @[320px]:table-cell", closed ? "text-muted-foreground" : chg > 0 ? "text-profit" : chg < 0 ? "text-loss" : "text-muted-foreground")}>
        {closed ? "closed" : `${chg > 0 ? "+" : ""}${chg.toFixed(2)}%`}
      </td>
    </tr>
  )
})

/** MT5-style Market Watch: a dense quote table, click a price to stage an order on that side. */
export function MarketWatch() {
  const { prices } = useMarket()
  const { activeSymbol } = useTradingState()
  const { setActiveSymbol, setDraft } = useTradingActions()
  const { favorites, isFavorite, toggleFavorite } = useWatchlist()
  const stats = useSessionStats(prices)
  const [cat, setCat] = useState<Cat>("all")
  const [query, setQuery] = useState("")

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return ASSETS.filter((a) => {
      if (q) return a.symbol.toLowerCase().includes(q) || a.label.toLowerCase().includes(q)
      if (cat === "favorites") return favorites.includes(a.symbol)
      if (cat === "all") return true
      return a.category === cat
    })
  }, [cat, query, favorites])

  const trade = (symbol: string, direction: Direction) => {
    setActiveSymbol(symbol)
    setDraft({ direction, type: "market" })
  }

  const asset = getAsset(activeSymbol)
  const live = prices[activeSymbol] ?? asset.basePrice
  const st = stats[activeSymbol]
  const low = st?.low ?? live
  const high = st?.high ?? live
  const pos = high > low ? ((live - low) / (high - low)) * 100 : 50

  return (
    <aside className="@container flex h-full min-h-0 flex-col bg-card">
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5">
        <h2 className="text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">Market watch</h2>
        <span className="font-mono text-[10.5px] text-muted-foreground tabular-nums">{list.length} symbols</span>
      </div>
      <div className="px-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search symbol"
            className="h-8 w-full rounded-lg bg-secondary pr-2 pl-8 text-[12px] outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
          />
        </div>
        {!query ? (
          <div className="mt-1.5 flex gap-0.5 rounded-lg bg-secondary p-0.5">
            {CATS.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setCat(c.key)}
                aria-pressed={cat === c.key}
                className={cn("h-6 flex-1 rounded-md text-[11px] font-semibold transition-colors", cat === c.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
              >
                {c.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="mt-1.5 min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b border-border text-[10px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
              <th className="py-1.5 pl-2 text-left font-semibold">Symbol</th>
              <th className="px-1.5 text-right font-semibold">Bid</th>
              <th className="px-1.5 text-right font-semibold">Ask</th>
              <th className="hidden pr-2 text-right font-semibold @[320px]:table-cell">Chg</th>
            </tr>
          </thead>
          <tbody>
            {list.map((a) => (
              <Row key={a.symbol} asset={a} price={prices[a.symbol] ?? a.basePrice} stats={stats[a.symbol]} active={a.symbol === activeSymbol} fav={isFavorite(a.symbol)} onSelect={setActiveSymbol} onTrade={trade} onFav={toggleFavorite} />
            ))}
          </tbody>
        </table>
        {list.length === 0 ? (
          <p className="px-4 py-8 text-center text-[12px] text-muted-foreground">{cat === "favorites" && !query ? "Pin symbols with the star to build your list." : "No symbol matches."}</p>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-border p-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[13px] font-semibold">{asset.symbol}</span>
          <span className="truncate text-[11px] text-muted-foreground">{asset.label}</span>
        </div>
        <div className="mt-2">
          <Sparkline data={st?.series ?? []} positive={live >= (st?.open ?? live)} />
        </div>
        <div className="mt-2 flex justify-between font-mono text-[10.5px] text-muted-foreground tabular-nums">
          <span>L {formatPrice(low, asset.digits)}</span>
          <span>H {formatPrice(high, asset.digits)}</span>
        </div>
        <div className="relative mt-1 h-1 rounded-full bg-secondary">
          <span className="absolute top-1/2 h-2.5 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground" style={{ left: `${Math.max(2, Math.min(98, pos))}%` }} />
        </div>
      </div>
    </aside>
  )
}
