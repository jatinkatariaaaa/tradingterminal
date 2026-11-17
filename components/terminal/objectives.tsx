"use client"

import { BadgeCheck, CalendarDays, CircleAlert, Gauge, PauseCircle, ShieldAlert, Target } from "lucide-react"
import { cn } from "@/lib/utils"
import { useMarket, useTradingState } from "./trading-provider"
import { Meter, money, tradingDays } from "./kit"

/**
 * The account's objectives as the engine sees them: profit target, the two loss
 * limits and the minimum trading days, with how much room is left on each.
 */
export function Objectives({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { derived } = useMarket()
  const { account, closedTrades, openPositions } = useTradingState()

  const start = account.startingBalance
  const targetAmount = start * account.profitTarget
  const profit = derived.equity - start
  const targetPct = targetAmount > 0 ? (Math.max(0, profit) / targetAmount) * 100 : 0
  const dailyLeft = Math.max(0, derived.dailyDrawdownLimit - derived.dailyDrawdownUsed)
  const maxLeft = Math.max(0, derived.maxDrawdownLimit - derived.maxDrawdownUsed)
  const dailyUsedPct = derived.dailyDrawdownLimit > 0 ? (derived.dailyDrawdownUsed / derived.dailyDrawdownLimit) * 100 : 0
  const maxUsedPct = derived.maxDrawdownLimit > 0 ? (derived.maxDrawdownUsed / derived.maxDrawdownLimit) * 100 : 0
  const days = tradingDays(closedTrades, openPositions)

  const status =
    account.status === "passed"
      ? { icon: BadgeCheck, text: "Objective reached. Your next account is being issued in your dashboard.", tone: "text-buy bg-buy/10" }
      : account.status === "breached"
        ? { icon: ShieldAlert, text: account.breachReason || "A loss limit was reached. This account is closed.", tone: "text-sell bg-sell/10" }
        : account.status === "suspended"
          ? { icon: PauseCircle, text: "Trading on this account is paused by The People Prop. Contact support for details.", tone: "text-warning bg-warning/10" }
          : null

  const items = [
    ...(account.profitTarget > 0
      ? [
          {
            icon: Target,
            label: "Profit target",
            detail: `${money(Math.max(0, profit))} of ${money(targetAmount)}`,
            pct: targetPct,
            right: `${Math.min(100, targetPct).toFixed(0)}%`,
            tone: "volt" as const,
          },
        ]
      : []),
    {
      icon: Gauge,
      label: `Daily loss limit · ${(account.maxDailyDrawdown * 100).toFixed(0)}%`,
      detail: `${money(dailyLeft)} left today`,
      pct: dailyUsedPct,
      right: money(derived.dailyDrawdownLimit),
      tone: dailyUsedPct > 75 ? ("sell" as const) : dailyUsedPct > 45 ? ("warning" as const) : ("buy" as const),
    },
    {
      icon: ShieldAlert,
      label: `Max loss limit · ${(account.maxOverallDrawdown * 100).toFixed(0)}%`,
      detail: `${money(maxLeft)} left`,
      pct: maxUsedPct,
      right: money(derived.maxDrawdownLimit),
      tone: maxUsedPct > 75 ? ("sell" as const) : maxUsedPct > 45 ? ("warning" as const) : ("buy" as const),
    },
    ...(account.minTradingDays > 0
      ? [
          {
            icon: CalendarDays,
            label: "Minimum trading days",
            detail: days >= account.minTradingDays ? "Done" : `${account.minTradingDays - days} more to go`,
            pct: (days / account.minTradingDays) * 100,
            right: `${Math.min(days, account.minTradingDays)} / ${account.minTradingDays}`,
            tone: "volt" as const,
          },
        ]
      : []),
  ]

  return (
    <div className={cn("grid gap-3", className)}>
      {status ? (
        <p className={cn("flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-[12.5px] leading-relaxed font-medium", status.tone)}>
          <status.icon className="mt-0.5 h-4 w-4 shrink-0" />
          {status.text}
        </p>
      ) : null}
      <ul className={cn("grid gap-3", !compact && "sm:grid-cols-2")}>
        {items.map((it) => (
          <li key={it.label} className="rounded-xl border border-border bg-surface-2 p-3.5">
            <div className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2 text-[12.5px] font-medium text-muted-foreground">
                <it.icon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{it.label}</span>
              </span>
              <span className="font-mono text-[12.5px] font-semibold tabular-nums">{it.right}</span>
            </div>
            <div className="mt-2.5">
              <Meter value={it.pct} tone={it.tone} />
            </div>
            <p className="mt-2 text-[12px] text-muted-foreground">{it.detail}</p>
          </li>
        ))}
      </ul>
      {account.status === "none" ? (
        <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <CircleAlert className="h-4 w-4" /> Select an account to see its objectives.
        </p>
      ) : null}
    </div>
  )
}
