"use client"

import { ShieldAlert, ShieldCheck, Trophy } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatMoney } from "@/lib/trading/assets"
import { useServerAccounts } from "@/hooks/use-server-accounts"
import type { ServerAccount } from "@/lib/trading/account"

/**
 * READ-ONLY view of the user's server-authoritative accounts (Phase 3, Step 1).
 *
 * This renders exactly what Supabase returns and performs no risk math itself —
 * it is the first consumer of the server source of truth. It runs alongside the
 * existing client-driven AccountBar so the two can be compared before any client
 * logic is removed in later steps.
 */
function statusBadge(account: ServerAccount) {
  switch (account.status) {
    case "breached":
      return { Icon: ShieldAlert, label: "Breached", cls: "bg-[var(--loss)]/15 text-[var(--loss)]" }
    case "passed":
      return { Icon: Trophy, label: "Passed", cls: "bg-[var(--profit)]/15 text-[var(--profit)]" }
    case "funded":
      return { Icon: ShieldCheck, label: "Funded", cls: "bg-primary/15 text-primary" }
    default:
      return { Icon: ShieldCheck, label: "Active", cls: "bg-secondary text-secondary-foreground" }
  }
}

export function AccountSummary() {
  const { accounts, loading, error, signedOut } = useServerAccounts()

  if (loading) {
    return (
      <div className="px-4 py-3 text-xs text-muted-foreground">Loading accounts\u2026</div>
    )
  }
  if (signedOut) {
    return (
      <div className="px-4 py-3 text-xs text-muted-foreground">Sign in to view your evaluation accounts.</div>
    )
  }
  if (error) {
    return (
      <div className="px-4 py-3 text-xs text-[var(--loss)]">Could not load accounts: {error}</div>
    )
  }
  if (accounts.length === 0) {
    return (
      <div className="px-4 py-3 text-xs text-muted-foreground">No evaluation accounts yet.</div>
    )
  }

  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      {accounts.map((a) => {
        const badge = statusBadge(a)
        const pnl = a.equity - a.startingBalance
        return (
          <div
            key={a.id}
            className="flex items-center justify-between gap-4 rounded-md border border-border bg-card px-3 py-2"
          >
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-semibold">{a.label}</span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {a.phase} \u00b7 {formatMoney(a.startingBalance)}
              </span>
            </div>
            <div className="flex items-center gap-6">
              <div className="flex flex-col items-end">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Equity</span>
                <span className="font-mono text-sm font-semibold tabular-nums">{formatMoney(a.equity)}</span>
              </div>
              <div className="flex flex-col items-end">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">P&L</span>
                <span
                  className={cn(
                    "font-mono text-sm font-semibold tabular-nums",
                    pnl > 0 && "text-[var(--profit)]",
                    pnl < 0 && "text-[var(--loss)]",
                  )}
                >
                  {formatMoney(pnl)}
                </span>
              </div>
              <span
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold",
                  badge.cls,
                )}
              >
                <badge.Icon className="h-3.5 w-3.5" />
                {badge.label}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
