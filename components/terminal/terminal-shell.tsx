"use client"

import { useEffect, useState } from "react"
import { CandlestickChart, ArrowLeftRight, History as HistoryIcon, User } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Direction } from "@/lib/trading/types"
import { useIsMobile } from "@/hooks/use-mobile"
import { useTradingState, useTradingActions } from "./trading-provider"
import { AccountBar } from "./account-bar"
import { AssetPanel } from "./asset-panel"
import { ChartPanel } from "./chart-panel"
import { OrderTicket } from "./order-ticket"
import { MobileOrderPanel } from "./order-ticket"
import { ManagePanel } from "./manage-panel"
import { PositionsPanel } from "./positions-panel"
import { MobileWatchlist } from "./mobile-watchlist"
import { MobileHistory } from "./mobile-history"
import { MobileProfile } from "./mobile-profile"

/** Right-panel slot: the position manager takes over when one is being managed. */
function RightPanel() {
  const { managePositionId } = useTradingState()
  return managePositionId ? <ManagePanel /> : <OrderTicket />
}

type MobileTab = "trade" | "chart" | "history" | "profile"

const TABS: { key: MobileTab; label: string; icon: typeof CandlestickChart }[] = [
  { key: "trade", label: "Trade", icon: ArrowLeftRight },
  { key: "chart", label: "Chart", icon: CandlestickChart },
  { key: "history", label: "History", icon: HistoryIcon },
  { key: "profile", label: "Profile", icon: User },
]

function MobileLayout() {
  const [tab, setTab] = useState<MobileTab>("trade")
  const { managePositionId, account } = useTradingState()
  const { setActiveSymbol, setDraft } = useTradingActions()

  // Tapping a symbol (or its Sell/Buy quote) in the Trade tab loads it on the
  // chart with the chosen direction pre-selected, then reveals the Chart tab.
  const openChart = (symbol: string, direction?: Direction) => {
    setActiveSymbol(symbol)
    if (direction) setDraft({ direction })
    setTab("chart")
  }

  // When the trader taps "manage" on a position, switch to chart tab where
  // the manage panel overlays the order panel.
  useEffect(() => {
    if (managePositionId) setTab("chart")
  }, [managePositionId])

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-background text-foreground">
      {/* Active panel content */}
      <main className="relative min-h-0 flex-1">
        {/* Trade tab: cTrader-style watchlist with Sell/Buy quotes */}
        <Panel show={tab === "trade"}>
          <MobileWatchlist balance={account.balance} onOpenChart={openChart} />
        </Panel>

        {/* Chart tab: compact symbol bar + chart + order/manage panel (SL/TP drag) */}
        <Panel show={tab === "chart"}>
          <div className="flex h-full flex-col">
            <AccountBar />
            <div className="min-h-0 flex-1">
              <ChartPanel />
            </div>
            <div className="shrink-0">
              {managePositionId ? (
                <div className="max-h-[45dvh] overflow-y-auto border-t border-border">
                  <ManagePanel />
                </div>
              ) : (
                <MobileOrderPanel />
              )}
            </div>
          </div>
        </Panel>

        {/* History tab: MT5-style positions / orders / deals + balance ledger */}
        <Panel show={tab === "history"}>
          <MobileHistory />
        </Panel>

        {/* Profile tab: evaluation details, drawdown limits & account */}
        <Panel show={tab === "profile"}>
          <MobileProfile />
        </Panel>
      </main>

      {/* Bottom navigation */}
      <nav className="flex shrink-0 items-stretch border-t border-border bg-card pb-[env(safe-area-inset-bottom)]">
        {TABS.map(({ key, label, icon: Icon }) => {
          const active = tab === key
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors",
                active ? "text-primary" : "text-muted-foreground",
              )}
            >
              <Icon className={cn("h-4.5 w-4.5", active && "stroke-[2.5]")} />
              {label}
            </button>
          )
        })}
      </nav>
    </div>
  )
}

/**
 * Keeps a panel mounted (so the chart instance and its state survive tab
 * switches) but uses `display:none` when inactive. We can't use `visibility`
 * here because the chart overlay sets `visibility: visible` on its lines every
 * frame, which would bleed through onto other tabs. `display:none` hides all
 * descendants unconditionally, and the chart's `autoSize` ResizeObserver
 * re-measures the container when it becomes visible again.
 */
function Panel({ show, children }: { show: boolean; children: React.ReactNode }) {
  return (
    <div className={cn("absolute inset-0 flex min-h-0 flex-col", !show && "hidden")} aria-hidden={!show}>
      {children}
    </div>
  )
}

function DesktopLayout() {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <AccountBar />
      <main className="grid min-h-0 flex-1 grid-cols-1 gap-px bg-border lg:grid-cols-[260px_minmax(0,1fr)_320px]">
        {/* LEFT — Asset matrix */}
        <AssetPanel />

        {/* MIDDLE — Chart engine + open positions */}
        <div className="flex min-h-0 flex-col gap-px bg-border">
          <div className="min-h-0 flex-1 bg-background">
            <ChartPanel />
          </div>
          <div className="h-[38%] min-h-[180px] bg-background">
            <PositionsPanel />
          </div>
        </div>

        {/* RIGHT — Order ticket / position manager */}
        <RightPanel />
      </main>
    </div>
  )
}

export function TerminalShell() {
  const isMobile = useIsMobile()
  return isMobile ? <MobileLayout /> : <DesktopLayout />
}
