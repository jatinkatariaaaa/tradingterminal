"use client"

import { useEffect, useState } from "react"
import { useTheme } from "next-themes"
import { ArrowUpRight, Keyboard, Moon, Star, Sun, TrendingDown, TrendingUp, Wallet } from "lucide-react"
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command"
import { ASSETS, formatPrice } from "@/lib/trading/assets"
import { useWatchlist } from "@/hooks/use-watchlist"
import { useMarket, useTradingActions, useTradingState } from "../trading-provider"
import { accountTitle } from "../account-switcher"
import { SITE_URL } from "../brand"
import { OPEN_PALETTE, openShortcuts } from "../desktop/events"

const GROUPS = [
  { key: "forex", label: "Forex" },
  { key: "commodities", label: "Metals" },
  { key: "crypto", label: "Crypto" },
] as const

/**
 * Ctrl+K (or /) command palette: jump to any symbol, stage a buy or sell, switch
 * account, or open the dashboard, without leaving the keyboard.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const { prices } = useMarket()
  const { accounts, accountId } = useTradingState()
  const { setActiveSymbol, setDraft, setAccountId } = useTradingActions()
  const { toggleFavorite, isFavorite } = useWatchlist()
  const { resolvedTheme, setTheme } = useTheme()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen((v) => !v)
        return
      }
      const t = e.target as HTMLElement | null
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        setOpen(true)
      }
    }
    const show = () => setOpen(true)
    window.addEventListener("keydown", onKey)
    window.addEventListener(OPEN_PALETTE, show)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener(OPEN_PALETTE, show)
    }
  }, [])

  const run = (fn: () => void) => {
    fn()
    setOpen(false)
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Search" description="Search markets, accounts and actions">
      <CommandInput placeholder="Symbol, account or action…" />
      <CommandList className="max-h-[420px]">
        <CommandEmpty>Nothing matches.</CommandEmpty>
        {GROUPS.map(({ key, label }) => (
          <CommandGroup key={key} heading={label}>
            {ASSETS.filter((a) => a.category === key).map((a) => (
              <CommandItem key={a.symbol} value={`${a.symbol} ${a.label}`} onSelect={() => run(() => setActiveSymbol(a.symbol))}>
                <span className="w-[76px] font-semibold">{a.symbol}</span>
                <span className="truncate text-muted-foreground">{a.label}</span>
                <span className="ml-auto font-mono text-xs text-muted-foreground tabular-nums">{formatPrice(prices[a.symbol] ?? NaN, a.digits)}</span>
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
        {accounts.length > 1 ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Accounts">
              {accounts.map((a) => (
                <CommandItem key={a.id} value={`account ${accountTitle(a)} ${a.id}`} onSelect={() => run(() => setAccountId(a.id))}>
                  <Wallet />
                  <span className="font-medium">{accountTitle(a)}</span>
                  <span className="text-muted-foreground capitalize">{a.status}</span>
                  {a.id === accountId ? <span className="ml-auto text-xs text-muted-foreground">current</span> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}
        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem value="buy ticket direction" onSelect={() => run(() => setDraft({ direction: "buy", type: "market" }))}>
            <TrendingUp className="text-buy" /> Set the ticket to buy
          </CommandItem>
          <CommandItem value="sell ticket direction" onSelect={() => run(() => setDraft({ direction: "sell", type: "market" }))}>
            <TrendingDown className="text-sell" /> Set the ticket to sell
          </CommandItem>
          <CommandItem value="theme light dark" onSelect={() => run(() => setTheme(resolvedTheme === "dark" ? "light" : "dark"))}>
            {resolvedTheme === "dark" ? <Sun /> : <Moon />} Switch to {resolvedTheme === "dark" ? "light" : "dark"} theme
          </CommandItem>
          <CommandItem value="keyboard shortcuts help" onSelect={() => run(openShortcuts)}>
            <Keyboard /> Keyboard shortcuts
          </CommandItem>
          <CommandItem value="dashboard payouts stipend" onSelect={() => run(() => window.open(`${SITE_URL}/dashboard`, "_blank", "noopener"))}>
            <ArrowUpRight /> Open the dashboard
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
