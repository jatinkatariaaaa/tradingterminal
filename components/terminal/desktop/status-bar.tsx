"use client"

import { useEffect, useState } from "react"
import { Command, Keyboard } from "lucide-react"
import { cn } from "@/lib/utils"
import { isMarketOpen } from "@/lib/trading/market-hours"
import { useMarket, useTradingState } from "../trading-provider"
import { openPalette, openShortcuts, SESSIONS, sessionOpen } from "./events"

function useNow(ms: number) {
  // null until mounted, so server and first client render agree
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

const pad = (n: number) => String(n).padStart(2, "0")

/** The strip under the workspace: feed, server time, sessions, login and shortcuts. */
export function StatusBar() {
  const { binanceConnected } = useMarket()
  const { accounts, accountId, account, openPositions, pendingOrders } = useTradingState()
  const now = useNow(1000)
  const current = accounts.find((a) => a.id === accountId)
  const fxOpen = now ? isMarketOpen("forex") : true

  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-border bg-card px-3 text-[11px] text-muted-foreground">
      <span className="flex items-center gap-1.5" title={binanceConnected ? "Crypto prices are streaming; forex and gold update from the quote feed" : "Connecting to the crypto price stream"}>
        <span className={cn("h-1.5 w-1.5 rounded-full", binanceConnected ? "bg-profit shadow-[0_0_0_3px] shadow-profit/20" : "bg-warning")} />
        {binanceConnected ? "Prices live" : "Connecting"}
      </span>
      <span className="font-mono tabular-nums" title="Server time (UTC)">
        {now ? `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())} UTC` : "--:--:-- UTC"}
      </span>
      <span className="hidden items-center gap-3 lg:flex" aria-label="Trading sessions">
        {SESSIONS.map((s) => {
          const on = !!now && fxOpen && sessionOpen(s.tz, s.open, s.close, now)
          return (
            <span key={s.name} className={cn("flex items-center gap-1", on ? "text-foreground" : "")} title={`${s.name} session ${on ? "open" : "closed"}`}>
              <span className={cn("h-1.5 w-1.5 rounded-full", on ? "bg-profit" : "bg-muted-foreground/40")} />
              {s.name}
            </span>
          )
        })}
        {!fxOpen ? <span className="rounded-full bg-warning/15 px-2 py-px font-medium text-warning">FX weekend</span> : null}
      </span>

      <span className="ml-auto hidden items-center gap-3 md:flex">
        <span className="tabular-nums">
          {openPositions.length} open · {pendingOrders.length} pending
        </span>
        {current ? (
          <span className="font-mono tabular-nums" title="Account login">
            #{current.id.slice(0, 8)} · 1:{account.leverage}
          </span>
        ) : null}
      </span>
      <button type="button" onClick={openPalette} className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-secondary hover:text-foreground">
        <Command className="h-3 w-3" /> K <span className="hidden xl:inline">Search</span>
      </button>
      <button type="button" onClick={openShortcuts} className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-secondary hover:text-foreground">
        <Keyboard className="h-3 w-3" /> <span className="hidden xl:inline">Shortcuts</span>
      </button>
    </footer>
  )
}
