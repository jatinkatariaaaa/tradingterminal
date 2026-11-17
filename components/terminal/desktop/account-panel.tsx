"use client"

import { useState } from "react"
import { ArrowUpRight, Copy, CopyCheck } from "lucide-react"
import { cn } from "@/lib/utils"
import { useMarket, useTradingState } from "../trading-provider"
import { accountTitle } from "../account-switcher"
import { Objectives } from "../objectives"
import { SITE_URL } from "../brand"
import { money, pnlTone } from "../kit"

const STATUS: Record<string, { label: string; tone: string }> = {
  active: { label: "Evaluation", tone: "bg-buy/12 text-buy" },
  funded: { label: "Funded", tone: "bg-volt/20 text-volt-ink" },
  passed: { label: "Passed", tone: "bg-sky-500/12 text-sky-500" },
  breached: { label: "Breached", tone: "bg-sell/12 text-sell" },
  suspended: { label: "Paused", tone: "bg-warning/15 text-warning" },
  none: { label: "No account", tone: "bg-secondary text-muted-foreground" },
}

const PROGRAM: Record<string, string> = { "1-step": "1-Step", "2-step": "2-Step", "3-step": "3-Step", instant: "Instant Funded", access: "Access" }

/** Left-panel view of the selected account: equity, margin, objectives and shortcuts to the dashboard. */
export function AccountPanel() {
  const { derived } = useMarket()
  const { account, accounts, accountId } = useTradingState()
  const [copied, setCopied] = useState(false)
  const current = accounts.find((a) => a.id === accountId)
  const st = STATUS[account.status] ?? STATUS.none
  const growth = account.startingBalance ? ((derived.equity - account.startingBalance) / account.startingBalance) * 100 : 0

  return (
    <aside className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5">
        <h2 className="text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">Account</h2>
        <span className={cn("rounded-full px-2 py-0.5 text-[10.5px] font-semibold", st.tone)}>{st.label}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 scrollbar-thin">
        <div className="rounded-xl border border-border bg-background/60 p-3">
          <p className="truncate text-[14px] font-semibold tracking-tight">{current ? accountTitle(current) : "No account selected"}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
            {current?.programKey ? `${PROGRAM[current.programKey] ?? current.programKey} · ` : ""}1:{account.leverage}
            {current ? (
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(current.id)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1400)
                  } catch {
                    // clipboard blocked
                  }
                }}
                className="ml-auto flex items-center gap-1 font-mono hover:text-foreground"
                title="Copy account login"
              >
                #{current.id.slice(0, 8)}
                {copied ? <CopyCheck className="h-3 w-3 text-profit" /> : <Copy className="h-3 w-3" />}
              </button>
            ) : null}
          </p>
          <div className="mt-3 flex items-end justify-between gap-2 border-t border-border pt-3">
            <div>
              <p className="text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase">Equity</p>
              <p className="font-mono text-[20px] leading-tight font-semibold tracking-tight tabular-nums">{money(derived.equity)}</p>
            </div>
            <p className={cn("font-mono text-[12.5px] font-semibold tabular-nums", pnlTone(growth))}>
              {growth > 0 ? "+" : ""}
              {growth.toFixed(2)}%
            </p>
          </div>
        </div>

        <dl className="mt-3 divide-y divide-border rounded-xl border border-border">
          {(
            [
              ["Balance", money(account.balance), ""],
              ["Floating P/L", money(derived.floatingPnl, { sign: true }), pnlTone(derived.floatingPnl)],
              ["Margin", money(derived.usedMargin), ""],
              ["Free margin", money(derived.freeMargin), ""],
              ["Margin level", derived.marginLevel == null ? "—" : `${derived.marginLevel.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`, ""],
              ["Starting balance", money(account.startingBalance), ""],
            ] as const
          ).map(([k, v, tone]) => (
            <div key={k} className="flex items-center justify-between px-3 py-2">
              <dt className="text-[12px] text-muted-foreground">{k}</dt>
              <dd className={cn("font-mono text-[12.5px] font-semibold tabular-nums", tone)}>{v}</dd>
            </div>
          ))}
        </dl>

        <h3 className="mt-4 mb-2 text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">Objectives</h3>
        <Objectives compact />

        <div className="mt-4 grid gap-1.5">
          {[
            ["/dashboard", "Dashboard"],
            ["/dashboard/payouts", "Payouts and stipend"],
            ["/rules", "Trading rules"],
          ].map(([href, label]) => (
            <a key={href} href={`${SITE_URL}${href}`} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-[12.5px] font-medium transition-colors hover:bg-accent">
              {label}
              <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />
            </a>
          ))}
        </div>
      </div>
    </aside>
  )
}
