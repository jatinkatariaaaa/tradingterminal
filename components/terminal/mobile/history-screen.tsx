"use client"

import { useMemo, useState } from "react"
import { History } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatPrice, getAsset } from "@/lib/trading/assets"
import type { ClosedTrade } from "@/lib/trading/types"
import { useTradingState } from "../trading-provider"
import { DirChip, money, pnlTone } from "../kit"
import { TradeReplayLink } from "../replay/replay-link"
import { Chips, duration, Empty, ScreenHeader, stamp } from "./ui"

type Period = "today" | "week" | "month" | "quarter" | "all"

const PERIODS: { key: Period; label: string }[] = [
  { key: "all", label: "All" },
  { key: "today", label: "Today" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "quarter", label: "3 months" },
]

const DAY = 86_400_000

function since(period: Period): number {
  const now = Date.now()
  if (period === "today") {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }
  if (period === "week") return now - 7 * DAY
  if (period === "month") return now - 30 * DAY
  if (period === "quarter") return now - 91 * DAY
  return 0
}

const REASON: Record<ClosedTrade["reason"], string> = {
  tp: "Take profit",
  sl: "Stop loss",
  manual: "Closed by you",
  breach: "Rule breach",
}

function Deal({ t, open, onToggle }: { t: ClosedTrade; open: boolean; onToggle: () => void }) {
  const asset = getAsset(t.symbol)
  return (
    <li className={cn(open && "bg-card")}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-accent">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-[15px] font-semibold tracking-tight">{t.symbol}</span>
            <DirChip direction={t.direction} />
            <span className="font-mono text-[13px] text-muted-foreground tabular-nums">{t.volume}</span>
          </span>
          <span className="mt-0.5 block font-mono text-[12px] text-muted-foreground tabular-nums">
            {formatPrice(t.entryPrice, asset.digits)} → {formatPrice(t.exitPrice, asset.digits)}
          </span>
        </span>
        <span className="flex flex-col items-end">
          <span className={cn("font-mono text-[15px] font-semibold tabular-nums", pnlTone(t.realizedPnl))}>{money(t.realizedPnl, { sign: true })}</span>
          <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{stamp(t.closedAt, false)}</span>
        </span>
      </button>
      {open ? (
        <dl className="mx-4 mb-4 grid gap-1.5 rounded-xl bg-surface-2 p-3 text-[12px]">
          {(
            [
              ["Opened", stamp(t.openedAt)],
              ["Closed", stamp(t.closedAt)],
              ["Held for", duration(t.closedAt - t.openedAt)],
              ["S/L", t.stopLoss != null ? formatPrice(t.stopLoss, asset.digits) : "—"],
              ["T/P", t.takeProfit != null ? formatPrice(t.takeProfit, asset.digits) : "—"],
              ["Closed by", REASON[t.reason] ?? t.reason],
              ["Ticket", `#${t.id.slice(0, 8)}`],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="font-mono font-medium tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </li>
  )
}

export function HistoryScreen() {
  const { closedTrades, account, accountId, activeSymbol } = useTradingState()
  const [period, setPeriod] = useState<Period>("all")
  const [openId, setOpenId] = useState<string | null>(null)

  const deals = useMemo(() => {
    const from = since(period)
    return closedTrades.filter((t) => t.closedAt >= from).sort((a, b) => b.closedAt - a.closedAt)
  }, [closedTrades, period])

  const s = useMemo(() => {
    const profit = deals.reduce((a, t) => a + t.realizedPnl, 0)
    const wins = deals.filter((t) => t.realizedPnl > 0)
    const losses = deals.filter((t) => t.realizedPnl < 0)
    const grossWin = wins.reduce((a, t) => a + t.realizedPnl, 0)
    const grossLoss = Math.abs(losses.reduce((a, t) => a + t.realizedPnl, 0))
    return {
      profit,
      count: deals.length,
      winRate: deals.length ? (wins.length / deals.length) * 100 : 0,
      profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
      best: wins.length ? Math.max(...wins.map((t) => t.realizedPnl)) : 0,
      worst: losses.length ? Math.min(...losses.map((t) => t.realizedPnl)) : 0,
      lots: deals.reduce((a, t) => a + t.volume, 0),
    }
  }, [deals])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScreenHeader title="History">
        <Chips value={period} onChange={setPeriod} options={PERIODS} className="mb-2" />
        <TradeReplayLink accountId={accountId} symbol={activeSymbol} className="mb-2" />
      </ScreenHeader>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-6">
        <div className="px-4 pt-1">
          <div className="rounded-[20px] border border-border bg-card p-4">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground uppercase">Profit</p>
                <p className={cn("font-mono text-[28px] leading-tight font-semibold tracking-tight tabular-nums", pnlTone(s.profit))}>{money(s.profit, { sign: true })}</p>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase">Balance</p>
                <p className="font-mono text-[15px] font-semibold tabular-nums">{money(account.balance)}</p>
              </div>
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-3">
              {(
                [
                  ["Trades", String(s.count)],
                  ["Win rate", s.count ? `${s.winRate.toFixed(0)}%` : "—"],
                  ["Profit factor", s.profitFactor == null ? "—" : s.profitFactor.toFixed(2)],
                  ["Best", s.best ? money(s.best, { sign: true }) : "—"],
                  ["Worst", s.worst ? money(s.worst) : "—"],
                  ["Lots", s.lots ? s.lots.toFixed(2) : "—"],
                ] as const
              ).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-[11px] text-muted-foreground">{k}</dt>
                  <dd className="truncate font-mono text-[13px] font-semibold tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        {deals.length ? (
          <ul className="mt-4 divide-y divide-border/60 border-y border-border/60">
            {deals.map((t) => (
              <Deal key={`${t.id}-${t.closedAt}`} t={t} open={openId === `${t.id}-${t.closedAt}`} onToggle={() => setOpenId((v) => (v === `${t.id}-${t.closedAt}` ? null : `${t.id}-${t.closedAt}`))} />
            ))}
          </ul>
        ) : (
          <Empty icon={History} title="No closed trades" text={period === "all" ? "Closed trades on this account show up here, newest first." : "Nothing closed in this period. Try a longer range."} />
        )}
      </div>
    </div>
  )
}
