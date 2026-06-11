"use client"

import { Activity, ShieldAlert, Wifi, WifiOff } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatMoney, formatPrice, getAsset } from "@/lib/trading/assets"
import { useTrading } from "./trading-provider"
import { Progress } from "@/components/ui/progress"

function Metric({
  label,
  value,
  tone = "default",
}: {
  label: string
  value: string
  tone?: "default" | "profit" | "loss"
}) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "font-mono text-sm font-semibold tabular-nums",
          tone === "profit" && "text-[var(--profit)]",
          tone === "loss" && "text-[var(--loss)]",
        )}
      >
        {value}
      </span>
    </div>
  )
}

function DrawdownGauge({
  label,
  used,
  limit,
}: {
  label: string
  used: number
  limit: number
}) {
  const pct = Math.min(100, (used / limit) * 100)
  const danger = pct >= 80
  return (
    <div className="flex min-w-[140px] flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <span
          className={cn(
            "font-mono text-[10px] tabular-nums",
            danger ? "text-[var(--loss)]" : "text-muted-foreground",
          )}
        >
          {formatMoney(used)} / {formatMoney(limit)}
        </span>
      </div>
      <Progress
        value={pct}
        className={cn("h-1.5", danger && "[&>div]:bg-[var(--loss)]")}
      />
    </div>
  )
}

function StatusBadges({
  status,
  connected,
}: {
  status: string
  connected: boolean
}) {
  return (
    <>
      {status === "breached" && (
        <span className="flex items-center gap-1.5 rounded-md bg-[var(--loss)]/15 px-2 py-1 text-xs font-semibold text-[var(--loss)]">
          <ShieldAlert className="h-3.5 w-3.5" />
          Breached
        </span>
      )}
      <span
        className={cn(
          "flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium",
          connected
            ? "bg-[var(--profit)]/12 text-[var(--profit)]"
            : "bg-muted text-muted-foreground",
        )}
        title="Binance public WebSocket feed (crypto)"
      >
        {connected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
        <span className="hidden sm:inline">{connected ? "Live Feed" : "Connecting…"}</span>
      </span>
    </>
  )
}

export function AccountBar() {
  const { account, derived, binanceConnected, activeSymbol, marketPrice } = useTrading()
  const asset = getAsset(activeSymbol)
  const pnl = derived.floatingPnl
  const pnlTone = pnl > 0 ? "profit" : pnl < 0 ? "loss" : "default"

  return (
    <header className="border-b border-border bg-card">
      {/* ---- Desktop / tablet: single wrapped row ---- */}
      <div className="hidden flex-wrap items-center gap-x-8 gap-y-3 px-4 py-3 md:flex">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/15 text-primary">
            <Activity className="h-4 w-4" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold tracking-tight">The People Prop</span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Evaluation Terminal
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-7 gap-y-3">
          <Metric label="Balance" value={formatMoney(account.balance)} />
          <Metric
            label="Equity"
            value={formatMoney(derived.equity)}
            tone={derived.equity >= account.startingBalance ? "profit" : "loss"}
          />
          <Metric label="Floating P&L" value={formatMoney(pnl)} tone={pnlTone} />
          <Metric label="Free Margin" value={formatMoney(derived.freeMargin)} />
          <Metric
            label="Margin Level"
            value={derived.marginLevel == null ? "—" : `${derived.marginLevel.toFixed(0)}%`}
            tone={derived.marginLevel != null && derived.marginLevel < 100 ? "loss" : "default"}
          />
        </div>

        <div className="flex flex-wrap items-center gap-x-7 gap-y-3">
          <DrawdownGauge
            label="Daily Drawdown"
            used={derived.dailyDrawdownUsed}
            limit={derived.dailyDrawdownLimit}
          />
          <DrawdownGauge
            label="Max Drawdown"
            used={derived.maxDrawdownUsed}
            limit={derived.maxDrawdownLimit}
          />
        </div>

        <div className="ml-auto flex items-center gap-3">
          <StatusBadges status={account.status} connected={binanceConnected} />
        </div>
      </div>

      {/* ---- Mobile: compact single-row header (symbol + price + status) ---- */}
      <div className="flex items-center gap-2 px-3 py-1.5 md:hidden">
        <div className="flex h-5 w-5 items-center justify-center rounded bg-primary/15 text-primary">
          <Activity className="h-3 w-3" />
        </div>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-xs font-semibold">{asset.symbol}</span>
          <span className="font-mono text-xs font-semibold tabular-nums">
            {formatPrice(marketPrice, asset.digits)}
          </span>
          <span
            className={cn(
              "font-mono text-[10px] font-semibold tabular-nums",
              pnl > 0 ? "text-[var(--profit)]" : pnl < 0 ? "text-[var(--loss)]" : "text-muted-foreground",
            )}
          >
            {pnl >= 0 ? "+" : ""}{formatMoney(pnl)}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <StatusBadges status={account.status} connected={binanceConnected} />
        </div>
      </div>
    </header>
  )
}

/** Full account details panel — used in mobile Account tab. */
export function MobileAccountDetails() {
  const { account, derived, binanceConnected } = useTrading()
  const pnl = derived.floatingPnl
  const pnlTone = pnl > 0 ? "profit" : pnl < 0 ? "loss" : "default"

  return (
    <div className="flex flex-col gap-4 overflow-y-auto p-3">
      {/* Branding */}
      <div className="flex items-center gap-3 rounded-lg bg-card border border-border p-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <Activity className="h-5 w-5" />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-base font-semibold tracking-tight">The People Prop</span>
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Evaluation Terminal
          </span>
        </div>
        <div className="ml-auto">
          <StatusBadges status={account.status} connected={binanceConnected} />
        </div>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-0.5 rounded-lg bg-secondary/50 p-2.5">
          <Metric label="Balance" value={formatMoney(account.balance)} />
        </div>
        <div className="flex flex-col gap-0.5 rounded-lg bg-secondary/50 p-2.5">
          <Metric
            label="Equity"
            value={formatMoney(derived.equity)}
            tone={derived.equity >= account.startingBalance ? "profit" : "loss"}
          />
        </div>
        <div className="flex flex-col gap-0.5 rounded-lg bg-secondary/50 p-2.5">
          <Metric label="Float P&L" value={formatMoney(pnl)} tone={pnlTone} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-0.5 rounded-lg bg-secondary/50 p-2.5">
          <Metric label="Free Margin" value={formatMoney(derived.freeMargin)} />
        </div>
        <div className="flex flex-col gap-0.5 rounded-lg bg-secondary/50 p-2.5">
          <Metric label="Used Margin" value={formatMoney(derived.usedMargin)} />
        </div>
        <div className="flex flex-col gap-0.5 rounded-lg bg-secondary/50 p-2.5">
          <Metric
            label="Margin Lvl"
            value={derived.marginLevel == null ? "—" : `${derived.marginLevel.toFixed(0)}%`}
            tone={derived.marginLevel != null && derived.marginLevel < 100 ? "loss" : "default"}
          />
        </div>
      </div>

      {/* Drawdown gauges */}
      <div className="flex flex-col gap-3">
        <div className="rounded-lg bg-secondary/50 p-3">
          <DrawdownGauge
            label="Daily Drawdown"
            used={derived.dailyDrawdownUsed}
            limit={derived.dailyDrawdownLimit}
          />
        </div>
        <div className="rounded-lg bg-secondary/50 p-3">
          <DrawdownGauge
            label="Max Drawdown"
            used={derived.maxDrawdownUsed}
            limit={derived.maxDrawdownLimit}
          />
        </div>
      </div>

      {/* Account info */}
      <div className="rounded-lg border border-border bg-card p-3">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Challenge Details
        </h3>
        <dl className="flex flex-col gap-2 text-xs">
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Starting Balance</dt>
            <dd className="font-mono font-semibold tabular-nums">{formatMoney(account.startingBalance)}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Current Balance</dt>
            <dd className="font-mono font-semibold tabular-nums">{formatMoney(account.balance)}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Account Status</dt>
            <dd className="font-semibold capitalize">{account.status}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Leverage</dt>
            <dd className="font-mono font-semibold">1:100</dd>
          </div>
        </dl>
      </div>
    </div>
  )
}
