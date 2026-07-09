"use client"

import { useEffect, useRef, useState } from "react"
import { Activity, ShieldAlert, Wifi, WifiOff } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatMoney } from "@/lib/trading/assets"
import { useMarket, useTradingState, useTradingActions } from "../trading-provider"
import { useServerAccounts } from "@/hooks/use-server-accounts"
import { ThemeToggle } from "../theme-toggle"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

/** A single account metric cell with a subtle flash when the value moves. */
function MetricCell({
  label,
  value,
  tone = "default",
  flashKey,
}: {
  label: string
  value: string
  tone?: "default" | "profit" | "loss"
  flashKey?: number
}) {
  const prevRef = useRef(flashKey)
  const [flash, setFlash] = useState<"up" | "down" | null>(null)
  useEffect(() => {
    if (flashKey === undefined || prevRef.current === undefined) {
      prevRef.current = flashKey
      return
    }
    if (flashKey > prevRef.current) setFlash("up")
    else if (flashKey < prevRef.current) setFlash("down")
    prevRef.current = flashKey
    if (flashKey !== undefined) {
      const t = setTimeout(() => setFlash(null), 600)
      return () => clearTimeout(t)
    }
  }, [flashKey])

  return (
    <div
      className={cn(
        "flex flex-col rounded-lg px-2.5 py-1",
        flash === "up" && "flash-up",
        flash === "down" && "flash-down",
      )}
    >
      <span className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "font-mono text-[13px] font-semibold leading-tight tabular-nums",
          tone === "profit" && "text-profit",
          tone === "loss" && "text-loss",
        )}
      >
        {value}
      </span>
    </div>
  )
}

function DrawdownMeter({
  label,
  used,
  limit,
}: {
  label: string
  used: number
  limit: number
}) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0
  const danger = pct >= 80
  const warn = pct >= 50 && pct < 80
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex w-[110px] flex-col gap-1" aria-label={`${label}: ${pct.toFixed(0)}% used`}>
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
              {label}
            </span>
            <span
              className={cn(
                "font-mono text-[9px] tabular-nums",
                danger ? "text-loss" : warn ? "text-warning" : "text-muted-foreground",
              )}
            >
              {pct.toFixed(0)}%
            </span>
          </div>
          <Progress
            value={pct}
            className={cn(
              "h-1",
              danger ? "[&>div]:bg-loss" : warn ? "[&>div]:bg-warning" : "[&>div]:bg-profit",
            )}
          />
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="font-mono text-xs tabular-nums">
        {formatMoney(used)} / {formatMoney(limit)}
      </TooltipContent>
    </Tooltip>
  )
}

function UtcClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  const hh = String(now.getUTCHours()).padStart(2, "0")
  const mm = String(now.getUTCMinutes()).padStart(2, "0")
  const ss = String(now.getUTCSeconds()).padStart(2, "0")
  return (
    <span
      className="hidden font-mono text-[11px] tabular-nums text-muted-foreground xl:inline"
      title="Server time (UTC)"
    >
      {hh}:{mm}:{ss} UTC
    </span>
  )
}

export function TopBar() {
  const { derived, binanceConnected } = useMarket()
  const { account, accountId } = useTradingState()
  const { setAccountId } = useTradingActions()
  const { accounts } = useServerAccounts()

  const pnl = derived.floatingPnl
  const pnlTone = pnl > 0 ? "profit" : pnl < 0 ? "loss" : "default"
  // Flash keys: cents-resolution ints so tiny float noise doesn't flash.
  const equityKey = Math.round(derived.equity * 100)
  const pnlKey = Math.round(pnl * 100)

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-card px-3">
      {/* Brand + account selector */}
      <div className="flex items-center gap-2.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Activity className="h-4 w-4" />
        </div>
        {accounts.length > 1 ? (
          <Select value={accountId || undefined} onValueChange={setAccountId}>
            <SelectTrigger className="h-8 rounded-full border-border bg-secondary px-3 text-xs font-semibold shadow-none">
              <SelectValue placeholder="Select Account" />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="flex flex-col leading-none">
            <span className="text-xs font-semibold tracking-tight">The People Prop</span>
            <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
              Evaluation
            </span>
          </div>
        )}
      </div>

      {/* Account metrics — the live ticker strip */}
      <div className="flex items-center divide-x divide-border overflow-x-auto scrollbar-none">
        <MetricCell label="Balance" value={formatMoney(account.balance)} />
        <MetricCell
          label="Equity"
          value={formatMoney(derived.equity)}
          tone={derived.equity >= account.balance ? "profit" : "loss"}
          flashKey={equityKey}
        />
        <MetricCell
          label="Float P&L"
          value={`${pnl >= 0 ? "+" : ""}${formatMoney(pnl)}`}
          tone={pnlTone}
          flashKey={pnlKey}
        />
        <MetricCell label="Free Margin" value={formatMoney(derived.freeMargin)} />
        <MetricCell
          label="Margin Lvl"
          value={derived.marginLevel == null ? "—" : `${derived.marginLevel.toFixed(0)}%`}
          tone={derived.marginLevel != null && derived.marginLevel < 100 ? "loss" : "default"}
        />
      </div>

      {/* Drawdown meters */}
      <div className="hidden items-center gap-3 lg:flex">
        <DrawdownMeter
          label="Daily DD"
          used={derived.dailyDrawdownUsed}
          limit={derived.dailyDrawdownLimit}
        />
        <DrawdownMeter
          label="Max DD"
          used={derived.maxDrawdownUsed}
          limit={derived.maxDrawdownLimit}
        />
      </div>

      {/* Right cluster: status, clock, theme */}
      <div className="ml-auto flex items-center gap-2">
        <UtcClock />
        {account.status === "breached" && (
          <span className="flex items-center gap-1 rounded-full bg-loss/15 px-2.5 py-1 text-[11px] font-semibold text-loss">
            <ShieldAlert className="h-3.5 w-3.5" />
            Breached
          </span>
        )}
        <span
          className={cn(
            "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium",
            binanceConnected
              ? "bg-profit/12 text-profit"
              : "bg-muted text-muted-foreground",
          )}
          title="Binance public WebSocket feed (crypto)"
        >
          {binanceConnected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
          <span className="hidden md:inline">{binanceConnected ? "Live" : "Connecting…"}</span>
        </span>
        <ThemeToggle />
      </div>
    </header>
  )
}
