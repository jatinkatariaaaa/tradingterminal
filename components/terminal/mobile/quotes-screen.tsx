"use client"

import { memo, useEffect, useMemo, useState } from "react"
import { CandlestickChart, Clock3, Search, Star, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { ASSETS, bidAsk, formatPrice, getAsset, marginRequired, spreadOf, COMMISSION_PER_LOT } from "@/lib/trading/assets"
import { isMarketOpen } from "@/lib/trading/market-hours"
import type { Asset, Direction } from "@/lib/trading/types"
import { useSessionStats, type SymbolSessionStats } from "@/hooks/use-session-stats"
import { hasSavedFavorites, useWatchlist } from "@/hooks/use-watchlist"
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer"
import { useMarket, useTradingActions, useTradingState } from "../trading-provider"
import { BigPrice, money, useTick } from "../kit"
import { Chips, Empty, IconBtn, ScreenHeader } from "./ui"

type Cat = "favorites" | "all" | "forex" | "commodities" | "crypto"

const CATS: { key: Cat; label: string }[] = [
  { key: "favorites", label: "Favourites" },
  { key: "all", label: "All" },
  { key: "forex", label: "Forex" },
  { key: "commodities", label: "Metals" },
  { key: "crypto", label: "Crypto" },
]

/** Spread in points, the way MT5 shows it. */
const points = (asset: Asset, spread: number) => Math.round(spread * 10 ** asset.digits)

const QuoteRow = memo(function QuoteRow({
  asset,
  price,
  stats,
  fav,
  active,
  onOpen,
}: {
  asset: Asset
  price: number
  stats: SymbolSessionStats | undefined
  fav: boolean
  active: boolean
  onOpen: (symbol: string) => void
}) {
  const tick = useTick(price)
  const spread = spreadOf(asset, price)
  const { bid, ask } = bidAsk(price, spread)
  const open = stats?.open ?? price
  const chg = open ? ((price - open) / open) * 100 : 0
  const closed = !isMarketOpen(asset.category)

  return (
    <button
      type="button"
      onClick={() => onOpen(asset.symbol)}
      className={cn("grid w-full grid-cols-[minmax(0,1fr)_80px_80px] items-center gap-x-4 px-4 py-2.5 text-left transition-colors active:bg-accent", active && "bg-accent/50")}
    >
      <span className="min-w-0">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[15px] font-semibold tracking-tight">{asset.symbol}</span>
          {fav ? <Star className="h-3 w-3 shrink-0 fill-warning text-warning" /> : null}
        </span>
        <span className="mt-0.5 flex items-center gap-2 text-[11.5px] tabular-nums">
          {closed ? (
            <span className="flex items-center gap-1 text-muted-foreground">
              <Clock3 className="h-3 w-3" /> Closed
            </span>
          ) : (
            <span className={cn("font-semibold", chg > 0 ? "text-profit" : chg < 0 ? "text-loss" : "text-muted-foreground")}>
              {chg > 0 ? "+" : ""}
              {chg.toFixed(2)}%
            </span>
          )}
          <span className="text-muted-foreground">Spread {points(asset, spread)}</span>
        </span>
      </span>
      <span className="flex flex-col items-end">
        <BigPrice price={bid} digits={asset.digits} tone={tick === "down" ? "down" : tick === "up" ? "up" : null} className="text-[19px]" />
        <span className="font-mono text-[10.5px] text-muted-foreground tabular-nums">L {formatPrice(stats?.low ?? price, asset.digits)}</span>
      </span>
      <span className="flex flex-col items-end">
        <BigPrice price={ask} digits={asset.digits} tone={tick === "down" ? "down" : tick === "up" ? "up" : null} className="text-[19px]" />
        <span className="font-mono text-[10.5px] text-muted-foreground tabular-nums">H {formatPrice(stats?.high ?? price, asset.digits)}</span>
      </span>
    </button>
  )
})

function SymbolSheet({
  symbol,
  stats,
  onClose,
  onTrade,
  onChart,
}: {
  symbol: string | null
  stats: Record<string, SymbolSessionStats>
  onClose: () => void
  onTrade: (symbol: string, direction: Direction) => void
  onChart: (symbol: string) => void
}) {
  const { prices } = useMarket()
  const { account } = useTradingState()
  const { isFavorite, toggleFavorite } = useWatchlist()
  const asset = symbol ? getAsset(symbol) : null

  const body = (() => {
    if (!asset || !symbol) return null
    const price = prices[symbol] ?? asset.basePrice
    const spread = spreadOf(asset, price)
    const { bid, ask } = bidAsk(price, spread)
    const st = stats[symbol]
    const low = st?.low ?? price
    const high = st?.high ?? price
    const pos = high > low ? ((price - low) / (high - low)) * 100 : 50
    const margin = marginRequired(asset, 1, ask, prices, account.leverage)
    const open = isMarketOpen(asset.category)
    const fav = isFavorite(symbol)
    const specs: [string, string][] = [
      ["Contract size", `${asset.contractSize.toLocaleString("en-US")} ${asset.category === "crypto" ? "coin" : asset.category === "commodities" ? "oz" : "units"}`],
      ["Volume step", `${asset.lotStep} lot`],
      ["Digits", String(asset.digits)],
      ["Spread", `${points(asset, spread)} points`],
      ["Commission", `$${COMMISSION_PER_LOT} per lot per side`],
      ["Leverage", `1:${account.leverage}`],
      ["Margin, 1 lot", money(margin)],
      ["Sessions", asset.category === "crypto" ? "24/7" : "Sun 22:00 to Fri 22:00 UTC"],
    ]

    return (
      <div className="px-4 pb-[max(env(safe-area-inset-bottom),16px)]">
        <div className="flex items-start justify-between gap-3 pt-1">
          <div>
            <DrawerTitle className="text-[22px] font-bold tracking-tight">{asset.symbol}</DrawerTitle>
            <DrawerDescription className="text-[13px]">
              {asset.label} · {open ? <span className="text-profit">Market open</span> : <span>Market closed</span>}
            </DrawerDescription>
          </div>
          <button
            type="button"
            onClick={() => toggleFavorite(symbol)}
            aria-label={fav ? "Remove from favourites" : "Add to favourites"}
            className={cn("grid h-10 w-10 place-items-center rounded-full", fav ? "bg-warning/15 text-warning" : "bg-secondary text-muted-foreground")}
          >
            <Star className={cn("h-[18px] w-[18px]", fav && "fill-current")} />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => onTrade(symbol, "sell")} disabled={!account.tradable} className="flex flex-col items-start rounded-2xl bg-sell px-4 py-3 text-sell-foreground transition-opacity active:opacity-85 disabled:opacity-40">
            <span className="text-[11px] font-bold tracking-[0.08em] uppercase opacity-85">Sell</span>
            <BigPrice price={bid} digits={asset.digits} className="text-[22px] text-sell-foreground" />
          </button>
          <button type="button" onClick={() => onTrade(symbol, "buy")} disabled={!account.tradable} className="flex flex-col items-end rounded-2xl bg-buy px-4 py-3 text-buy-foreground transition-opacity active:opacity-85 disabled:opacity-40">
            <span className="text-[11px] font-bold tracking-[0.08em] uppercase opacity-85">Buy</span>
            <BigPrice price={ask} digits={asset.digits} className="text-[22px] text-buy-foreground" />
          </button>
        </div>

        <div className="mt-4 rounded-2xl border border-border bg-card p-4">
          <div className="flex justify-between font-mono text-[11.5px] text-muted-foreground tabular-nums">
            <span>L {formatPrice(low, asset.digits)}</span>
            <span className="font-sans text-[11px] font-semibold tracking-wide uppercase">Session range</span>
            <span>H {formatPrice(high, asset.digits)}</span>
          </div>
          <div className="relative mt-2.5 h-1.5 rounded-full bg-secondary">
            <span className="absolute top-1/2 h-3.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground" style={{ left: `${Math.max(2, Math.min(98, pos))}%` }} />
          </div>
        </div>

        <dl className="mt-3 divide-y divide-border rounded-2xl border border-border bg-card px-4">
          {specs.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-4 py-2.5">
              <dt className="text-[13px] text-muted-foreground">{k}</dt>
              <dd className="text-right text-[13px] font-semibold tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>

        <button type="button" onClick={() => onChart(symbol)} className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-secondary text-[14px] font-semibold active:bg-accent">
          <CandlestickChart className="h-4 w-4" /> Open chart
        </button>
      </div>
    )
  })()

  return (
    <Drawer open={!!symbol} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent className="max-h-[92dvh] overflow-y-auto rounded-t-[22px] border-border bg-background">{body}</DrawerContent>
    </Drawer>
  )
}

export function QuotesScreen({ onOpenChart }: { onOpenChart: () => void }) {
  const { prices } = useMarket()
  const { activeSymbol } = useTradingState()
  const { setActiveSymbol, setDraft } = useTradingActions()
  const { favorites, isFavorite } = useWatchlist()
  const stats = useSessionStats(prices)
  const [cat, setCat] = useState<Cat>("all")
  const [query, setQuery] = useState("")
  const [searching, setSearching] = useState(false)
  const [sheet, setSheet] = useState<string | null>(null)

  // Returning traders start on their favourites.
  useEffect(() => {
    if (hasSavedFavorites()) setCat("favorites")
  }, [])

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
    setSheet(null)
    onOpenChart()
  }
  const chart = (symbol: string) => {
    setActiveSymbol(symbol)
    setSheet(null)
    onOpenChart()
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScreenHeader
        title="Quotes"
        right={
          <IconBtn
            icon={searching ? X : Search}
            label={searching ? "Close search" : "Search symbols"}
            onClick={() => {
              setSearching((s) => !s)
              setQuery("")
            }}
          />
        }
      >
        {searching ? (
          <div className="relative mb-2.5">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Symbol or name"
              className="h-10 w-full rounded-xl bg-secondary pr-3 pl-9 text-[15px] outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/40"
            />
          </div>
        ) : (
          <Chips value={cat} onChange={setCat} options={CATS} className="mb-2" />
        )}
        <div className="grid grid-cols-[minmax(0,1fr)_80px_80px] gap-x-4 border-b border-border pb-1.5 text-[10.5px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          <span>Symbol</span>
          <span className="text-right">Bid</span>
          <span className="text-right">Ask</span>
        </div>
      </ScreenHeader>

      <div className="min-h-0 flex-1 divide-y divide-border/60 overflow-y-auto overscroll-contain">
        {list.map((a) => (
          <QuoteRow key={a.symbol} asset={a} price={prices[a.symbol] ?? a.basePrice} stats={stats[a.symbol]} fav={isFavorite(a.symbol)} active={a.symbol === activeSymbol} onOpen={setSheet} />
        ))}
        {list.length === 0 ? (
          cat === "favorites" && !query ? (
            <Empty icon={Star} title="No favourites yet" text="Open any symbol and tap the star to keep it at the top of your quotes." />
          ) : (
            <Empty icon={Search} title="Nothing found" text="Try the symbol, like EURUSD or XAUUSD." />
          )
        ) : null}
      </div>

      <SymbolSheet symbol={sheet} stats={stats} onClose={() => setSheet(null)} onTrade={trade} onChart={chart} />
    </div>
  )
}
