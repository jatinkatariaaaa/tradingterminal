"use client"

import { useEffect, useState, type ReactNode } from "react"
import { ArrowDownUp, CandlestickChart, ChevronDown, History, LineChart, UserRound } from "lucide-react"
import { cn } from "@/lib/utils"
import { bidAsk, formatPrice, getAsset, spreadOf } from "@/lib/trading/assets"
import { useMarket, useTradingActions, useTradingState } from "../trading-provider"
import { ChartPanel } from "../chart-panel"
import { MobileOrderPanel } from "../order-ticket"
import { ManagePanel } from "../manage-panel"
import { money, pnlTone } from "../kit"
import { QuotesScreen } from "./quotes-screen"
import { TradeScreen } from "./trade-screen"
import { HistoryScreen } from "./history-screen"
import { AccountScreen } from "./account-screen"

type Tab = "quotes" | "chart" | "trade" | "history" | "account"

const TABS: { key: Tab; label: string; icon: typeof LineChart }[] = [
  { key: "quotes", label: "Quotes", icon: ArrowDownUp },
  { key: "chart", label: "Chart", icon: CandlestickChart },
  { key: "trade", label: "Trade", icon: LineChart },
  { key: "history", label: "History", icon: History },
  { key: "account", label: "Account", icon: UserRound },
]

/**
 * Keeps a screen mounted (the chart keeps its state between tabs) and hides it with
 * display:none; the chart overlay sets `visibility` on its lines, so visibility can't be used.
 */
function Screen({ show, children }: { show: boolean; children: ReactNode }) {
  return (
    <div className={cn("absolute inset-0 flex min-h-0 flex-col", !show && "hidden")} aria-hidden={!show}>
      {children}
    </div>
  )
}

function ChartHeader({ onPickSymbol }: { onPickSymbol: () => void }) {
  const { marketPrice, derived, binanceConnected } = useMarket()
  const { activeSymbol, openPositions } = useTradingState()
  const asset = getAsset(activeSymbol)
  const { bid, ask } = bidAsk(marketPrice, spreadOf(asset, marketPrice))
  const pnl = derived.floatingPnl
  return (
    <header className="flex shrink-0 items-center gap-2 border-b border-border bg-background px-3 pt-[max(env(safe-area-inset-top),6px)] pb-1.5">
      <button type="button" onClick={onPickSymbol} className="flex min-w-0 items-center gap-1 rounded-full py-1 pr-2 pl-1 active:bg-accent" aria-label="Change symbol">
        <span className="text-[17px] font-bold tracking-tight">{asset.symbol}</span>
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      </button>
      <span className="hidden min-w-0 truncate font-mono text-[11.5px] text-muted-foreground tabular-nums min-[380px]:inline">
        <span className="text-sell">{formatPrice(bid, asset.digits)}</span> / <span className="text-buy">{formatPrice(ask, asset.digits)}</span>
      </span>
      <span className="ml-auto flex items-center gap-2">
        {openPositions.length ? <span className={cn("rounded-full bg-secondary px-2.5 py-1 font-mono text-[12px] font-semibold tabular-nums", pnlTone(pnl))}>{money(pnl, { sign: true })}</span> : null}
        <span className={cn("h-2 w-2 rounded-full", binanceConnected ? "bg-profit" : "bg-muted-foreground")} title={binanceConnected ? "Live prices" : "Connecting"} />
      </span>
    </header>
  )
}

export function MobileShell() {
  const [tab, setTab] = useState<Tab>("chart")
  const [visited, setVisited] = useState<ReadonlySet<Tab>>(() => new Set(["chart"]))
  const [manageOpen, setManageOpen] = useState(false)
  const { managePositionId, openPositions, pendingOrders } = useTradingState()
  const { beginManage } = useTradingActions()

  // The manager closes itself (endManage) after a modify or close: drop the overlay with it.
  useEffect(() => {
    if (!managePositionId) setManageOpen(false)
  }, [managePositionId])

  const openTab = (next: Tab) => {
    // First paint only needs the chart. Retain each visited tab's filters and scroll state.
    setVisited((current) => current.has(next) ? current : new Set(current).add(next))
    setTab(next)
  }

  const badge: Partial<Record<Tab, number>> = { trade: openPositions.length + pendingOrders.length }

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-background text-foreground">
      <main className="relative min-h-0 flex-1">
        {visited.has("quotes") && (
          <Screen show={tab === "quotes"}>
            <QuotesScreen onOpenChart={() => openTab("chart")} />
          </Screen>
        )}

        <Screen show={tab === "chart"}>
          <ChartHeader onPickSymbol={() => openTab("quotes")} />
          <div className="min-h-0 flex-1">
            <ChartPanel />
          </div>
          <div className="shrink-0">
            <MobileOrderPanel onOpenFullManage={() => setManageOpen(true)} />
          </div>
        </Screen>

        {visited.has("trade") && (
          <Screen show={tab === "trade"}>
            <TradeScreen
              onOpenChart={() => openTab("chart")}
              onModify={(id) => {
                beginManage(id)
                setManageOpen(true)
              }}
            />
          </Screen>
        )}

        {visited.has("history") && (
          <Screen show={tab === "history"}>
            <HistoryScreen />
          </Screen>
        )}

        {visited.has("account") && (
          <Screen show={tab === "account"}>
            <AccountScreen />
          </Screen>
        )}

        {manageOpen && managePositionId ? (
          <div className="absolute inset-0 z-40 flex flex-col bg-background pt-[env(safe-area-inset-top)] animate-in slide-in-from-bottom-6 fade-in-0 duration-200">
            <div className="min-h-0 flex-1 overflow-y-auto">
              <ManagePanel />
            </div>
          </div>
        ) : null}
      </main>

      <nav className="grid shrink-0 grid-cols-5 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur" aria-label="Terminal">
        {TABS.map(({ key, label, icon: Icon }) => {
          const on = tab === key
          const n = badge[key] ?? 0
          return (
            <button
              key={key}
              type="button"
              onClick={() => {
                setManageOpen(false)
                openTab(key)
              }}
              aria-current={on ? "page" : undefined}
              className={cn("relative flex flex-col items-center gap-[3px] pt-2 pb-1.5 text-[10.5px] font-semibold transition-colors", on ? "text-foreground" : "text-muted-foreground")}
            >
              <span className={cn("grid h-7 w-12 place-items-center rounded-full transition-colors", on && "bg-volt text-[oklch(0.17_0.008_165)]")}>
                <Icon className="h-[18px] w-[18px]" />
              </span>
              {label}
              {n > 0 ? <span className="absolute top-1 left-[calc(50%+8px)] min-w-[17px] rounded-full bg-foreground px-1 text-center text-[10px] leading-[17px] font-bold text-background tabular-nums">{n}</span> : null}
            </button>
          )
        })}
      </nav>
    </div>
  )
}
