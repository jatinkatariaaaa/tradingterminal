"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ChevronUp, ChevronDown, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import { ASSETS, CATEGORY_LABELS, formatPrice } from "@/lib/trading/assets"
import type { Asset, AssetCategory } from "@/lib/trading/types"
import { useMarket, useTradingActions, useTradingState } from "./trading-provider"

const CATEGORIES: AssetCategory[] = ["forex", "crypto", "commodities"]

function AssetRow({ asset, active }: { asset: Asset; active: boolean }) {
  const { prices } = useMarket()
  const { setActiveSymbol } = useTradingActions()
  const price = prices[asset.symbol] ?? asset.basePrice

  // Track tick direction by comparing to the previously rendered price.
  const prevRef = useRef(price)
  const [dir, setDir] = useState<"up" | "down" | "flat">("flat")
  useEffect(() => {
    if (price > prevRef.current) setDir("up")
    else if (price < prevRef.current) setDir("down")
    prevRef.current = price
  }, [price])

  return (
    <button
      type="button"
      onClick={() => setActiveSymbol(asset.symbol)}
      className={cn(
        "flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left transition-colors",
        active ? "bg-primary/15 ring-1 ring-primary/40" : "hover:bg-accent",
      )}
    >
      <div className="flex flex-col leading-tight">
        <span className="text-sm font-medium">{asset.symbol}</span>
        <span className="text-[11px] text-muted-foreground">{asset.label}</span>
      </div>
      <div
        className={cn(
          "flex items-center gap-1 font-mono text-sm tabular-nums",
          dir === "up" && "text-[var(--profit)]",
          dir === "down" && "text-[var(--loss)]",
        )}
      >
        {dir === "up" && <ChevronUp className="h-3.5 w-3.5" />}
        {dir === "down" && <ChevronDown className="h-3.5 w-3.5" />}
        {formatPrice(price, asset.digits)}
      </div>
    </button>
  )
}

export function AssetPanel() {
  const { activeSymbol } = useTradingState()
  const [category, setCategory] = useState<AssetCategory>("forex")
  const [query, setQuery] = useState("")

  const counts = useMemo(() => {
    const c: Record<AssetCategory, number> = { forex: 0, crypto: 0, commodities: 0 }
    for (const a of ASSETS) c[a.category]++
    return c
  }, [])

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return ASSETS.filter((a) => {
      if (q) return a.symbol.toLowerCase().includes(q) || a.label.toLowerCase().includes(q)
      return a.category === category
    })
  }, [category, query])

  return (
    <aside className="flex min-h-0 flex-col bg-background">
      <div className="border-b border-border px-3 py-2.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Asset Matrix
        </h2>
      </div>

      {/* Search */}
      <div className="border-b border-border p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search symbol…"
            className="w-full rounded-md bg-secondary py-1.5 pl-7 pr-2 text-xs text-secondary-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>

      {/* Category tabs (hidden while searching) */}
      {query.trim() === "" && (
        <div className="flex gap-1 border-b border-border p-2">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                category === cat
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {CATEGORY_LABELS[cat]}
              <span className="text-[10px] opacity-60">{counts[cat]}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 space-y-1 overflow-y-auto p-2">
        {list.map((asset) => (
          <AssetRow key={asset.symbol} asset={asset} active={asset.symbol === activeSymbol} />
        ))}
        {list.length === 0 && (
          <p className="px-2.5 py-6 text-center text-xs text-muted-foreground">No matches.</p>
        )}
      </div>
    </aside>
  )
}
