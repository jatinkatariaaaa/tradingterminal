"use client"

import { useEffect, useState } from "react"
import { useTheme } from "next-themes"
import { Moon, Star, Sun, TrendingDown, TrendingUp } from "lucide-react"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import { ASSETS, CATEGORY_LABELS, formatPrice } from "@/lib/trading/assets"
import { useMarket, useTradingActions } from "../trading-provider"
import { useWatchlist } from "@/hooks/use-watchlist"

/**
 * Ctrl/Cmd+K command palette — instant symbol switching plus quick actions.
 * Listens for the shortcut globally so it works from any panel.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const { prices } = useMarket()
  const { setActiveSymbol, setDraft } = useTradingActions()
  const { toggleFavorite, isFavorite } = useWatchlist()
  const { resolvedTheme, setTheme } = useTheme()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const pick = (symbol: string, direction?: "buy" | "sell") => {
    setActiveSymbol(symbol)
    if (direction) setDraft({ direction, type: "market" })
    setOpen(false)
  }

  const grouped = (["forex", "crypto", "commodities"] as const).map((cat) => ({
    cat,
    assets: ASSETS.filter((a) => a.category === cat),
  }))

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Command palette" description="Search markets and actions">
      <CommandInput placeholder="Search markets or actions…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        {grouped.map(({ cat, assets }) => (
          <CommandGroup key={cat} heading={CATEGORY_LABELS[cat]}>
            {assets.map((a) => (
              <CommandItem
                key={a.symbol}
                value={`${a.symbol} ${a.label}`}
                onSelect={() => pick(a.symbol)}
              >
                <span className="font-semibold">{a.symbol}</span>
                <span className="text-muted-foreground">{a.label}</span>
                <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
                  {formatPrice(prices[a.symbol] ?? a.basePrice, a.digits)}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleFavorite(a.symbol)
                  }}
                  aria-label={isFavorite(a.symbol) ? `Unpin ${a.symbol}` : `Pin ${a.symbol}`}
                  className="ml-1 text-muted-foreground/50 hover:text-warning"
                >
                  <Star className="h-3.5 w-3.5" fill={isFavorite(a.symbol) ? "currentColor" : "none"} />
                </button>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem value="buy current market" onSelect={() => { setDraft({ direction: "buy", type: "market" }); setOpen(false) }}>
            <TrendingUp className="text-buy" />
            Set ticket to Buy
          </CommandItem>
          <CommandItem value="sell current market" onSelect={() => { setDraft({ direction: "sell", type: "market" }); setOpen(false) }}>
            <TrendingDown className="text-sell" />
            Set ticket to Sell
          </CommandItem>
          <CommandItem
            value="toggle theme light dark"
            onSelect={() => {
              setTheme(resolvedTheme === "dark" ? "light" : "dark")
              setOpen(false)
            }}
          >
            {resolvedTheme === "dark" ? <Sun /> : <Moon />}
            Switch to {resolvedTheme === "dark" ? "light" : "dark"} theme
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
