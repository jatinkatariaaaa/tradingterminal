"use client"

import { useEffect, useRef, useState } from "react"
import type { ImperativePanelHandle } from "react-resizable-panels"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { useTradingState } from "../trading-provider"
import { TopBar } from "../shell/top-bar"
import { useHotkeys } from "../shell/use-hotkeys"
import { MarketWatch } from "../market-watch"
import { ChartPanel } from "../chart-panel"
import { OrderTicket } from "../order-ticket"
import { ManagePanel } from "../manage-panel"
import { PositionsPanel } from "../positions-panel"
import { SideRail, type LeftPanel } from "./side-rail"
import { AccountPanel } from "./account-panel"
import { RiskCalculator } from "./risk-calculator"
import { StatusBar } from "./status-bar"
import { ShortcutsDialog } from "./shortcuts-dialog"

const LEFT_KEY = "tpp-left-panel"
const vHandle = "w-px bg-border transition-colors data-[resize-handle-state=hover]:bg-ring data-[resize-handle-state=drag]:bg-volt"
const hHandle = "h-px bg-border transition-colors data-[resize-handle-state=hover]:bg-ring data-[resize-handle-state=drag]:bg-volt"

/** Right-panel slot: the position manager takes over while a trade is being managed. */
function RightPanel() {
  const { managePositionId } = useTradingState()
  return managePositionId ? <ManagePanel /> : <OrderTicket />
}

/**
 * The PC workspace: top bar, an icon rail with switchable left panels, the chart
 * over the trade dock, the order ticket on the right and a status bar.
 */
export function DesktopShell() {
  useHotkeys()
  const leftRef = useRef<ImperativePanelHandle>(null)
  const [left, setLeft] = useState<LeftPanel>("watch")
  const [leftOpen, setLeftOpen] = useState(true)

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(LEFT_KEY) as LeftPanel | null
      if (saved === "watch" || saved === "account" || saved === "calc") setLeft(saved)
    } catch {
      // storage blocked
    }
  }, [])

  const pick = (k: LeftPanel) => {
    if (k === left && leftOpen) {
      leftRef.current?.collapse()
      return
    }
    setLeft(k)
    try {
      window.localStorage.setItem(LEFT_KEY, k)
    } catch {
      // ignore
    }
    if (!leftOpen) leftRef.current?.expand()
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <SideRail active={leftOpen ? left : null} onPick={pick} />
        <main className="min-h-0 min-w-0 flex-1">
          <ResizablePanelGroup direction="horizontal" autoSaveId="tpp-desk-h">
            <ResizablePanel
              ref={leftRef}
              id="left"
              order={1}
              defaultSize={20}
              minSize={15}
              maxSize={34}
              collapsible
              collapsedSize={0}
              onResize={(size) => setLeftOpen(size > 0)}
              className="bg-card"
            >
              {left === "watch" ? <MarketWatch /> : left === "account" ? <AccountPanel /> : <RiskCalculator />}
            </ResizablePanel>
            <ResizableHandle className={vHandle} />
            <ResizablePanel id="center" order={2} defaultSize={58} minSize={34}>
              <ResizablePanelGroup direction="vertical" autoSaveId="tpp-desk-v">
                <ResizablePanel id="chart" order={1} defaultSize={64} minSize={30}>
                  <ChartPanel />
                </ResizablePanel>
                <ResizableHandle className={hHandle} />
                <ResizablePanel id="dock" order={2} defaultSize={36} minSize={14} collapsible collapsedSize={0} className="bg-card">
                  <PositionsPanel />
                </ResizablePanel>
              </ResizablePanelGroup>
            </ResizablePanel>
            <ResizableHandle className={vHandle} />
            <ResizablePanel id="ticket" order={3} defaultSize={22} minSize={18} maxSize={32} className="bg-card">
              <RightPanel />
            </ResizablePanel>
          </ResizablePanelGroup>
        </main>
      </div>
      <StatusBar />
      <ShortcutsDialog />
    </div>
  )
}
