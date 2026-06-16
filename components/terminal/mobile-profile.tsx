"use client"

import { ArrowUp, LogOut, Plus, Target, TrendingDown, Wallet } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatMoney } from "@/lib/trading/assets"
import { useTrading } from "./trading-provider"
import { useServerAccounts } from "@/hooks/use-server-accounts"
import { signOut } from "@/app/(auth)/actions"
import { ThemeToggle } from "./theme-toggle"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

/** A labelled progress gauge for an evaluation limit. */
function LimitGauge({
  icon: Icon,
  label,
  used,
  limit,
  invert,
}: {
  icon: typeof Target
  label: string
  used: number
  limit: number
  /** When true, fuller bar = good (profit target). Otherwise fuller = danger. */
  invert?: boolean
}) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0
  const danger = !invert && pct >= 80
  const barColor = invert ? "var(--profit)" : danger ? "var(--loss)" : "var(--primary)"
  const barClass = invert
    ? "[&>div]:bg-[var(--profit)]"
    : danger
      ? "[&>div]:bg-[var(--loss)]"
      : "[&>div]:bg-primary"
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Icon className="h-4 w-4 text-muted-foreground" />
          {label}
        </div>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {formatMoney(used)} / {formatMoney(limit)}
        </span>
      </div>
      <Progress value={pct} className={cn("mt-2 h-2", barClass)} />
      <div className="mt-1 text-right text-[11px] font-medium" style={{ color: barColor }}>
        {pct.toFixed(0)}%
      </div>
    </div>
  )
}

export function MobileProfile() {
  const { account, derived, accountId, setAccountId } = useTrading()
  const { accounts } = useServerAccounts()
  const serverAccount = accounts.find((a) => a.id === accountId)

  const phase = serverAccount?.phase ?? "challenge"
  const status = serverAccount?.status ?? account.status
  const profitTargetPct = serverAccount?.profitTarget ?? 0.1
  const targetProfit = account.startingBalance * profitTargetPct
  const currentProfit = Math.max(0, derived.equity - account.startingBalance)
  const accountNumber = accountId ? accountId.replace(/\D/g, "").slice(0, 7).padStart(7, "0") : "0000000"

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-background">
      {/* Gradient header */}
      <header className="relative bg-primary px-4 pt-[max(env(safe-area-inset-top),1rem)] pb-16 text-primary-foreground">
        <div className="flex items-center justify-between">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-foreground/20 text-sm font-bold">
            TPP
          </div>
          <ThemeToggle />
        </div>
        <h1 className="mt-3 text-lg font-bold tracking-tight">The People Prop</h1>
        <p className="text-xs text-primary-foreground/70">Evaluation Terminal</p>
      </header>

      {/* Account card overlapping the header */}
      <div className="-mt-12 px-4">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            {accounts.length > 1 ? (
              <Select value={accountId || undefined} onValueChange={setAccountId}>
                <SelectTrigger className="h-8 w-auto gap-1 rounded-full border-border bg-secondary text-sm font-semibold">
                  <SelectValue placeholder="Select account" />
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
              <span className="rounded-full bg-secondary px-3 py-1 font-mono text-sm font-semibold">
                #{accountNumber}
              </span>
            )}
            <span
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide",
                status === "breached"
                  ? "bg-[var(--loss)]/15 text-[var(--loss)]"
                  : "bg-[var(--profit)]/15 text-[var(--profit)]",
              )}
            >
              {phase === "funded" ? "Funded" : "Challenge"}
            </span>
          </div>

          <div className="mt-4 text-center">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Account Balance</p>
            <p className="font-mono text-3xl font-bold tabular-nums">{formatMoney(account.balance)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Equity{" "}
              <span
                className="font-mono font-semibold"
                style={{ color: derived.equity >= account.startingBalance ? "var(--profit)" : "var(--loss)" }}
              >
                {formatMoney(derived.equity)}
              </span>
            </p>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2">
            <ActionTile icon={Plus} label="Deposit" />
            <ActionTile icon={ArrowUp} label="Withdraw" />
            <ActionTile icon={Wallet} label="Free margin" value={formatMoney(derived.freeMargin)} />
          </div>
        </div>
      </div>

      {/* Evaluation details */}
      <section className="px-4 pt-5">
        <h2 className="mb-2 text-sm font-bold">Evaluation</h2>
        <div className="flex flex-col gap-2">
          <LimitGauge icon={Target} label="Profit target" used={currentProfit} limit={targetProfit} invert />
          <LimitGauge
            icon={TrendingDown}
            label="Daily drawdown"
            used={derived.dailyDrawdownUsed}
            limit={derived.dailyDrawdownLimit}
          />
          <LimitGauge
            icon={TrendingDown}
            label="Max drawdown"
            used={derived.maxDrawdownUsed}
            limit={derived.maxDrawdownLimit}
          />
        </div>
      </section>

      {/* Account details */}
      <section className="px-4 pt-5">
        <h2 className="mb-2 text-sm font-bold">Account details</h2>
        <dl className="overflow-hidden rounded-xl border border-border bg-card">
          <DetailRow label="Starting balance" value={formatMoney(account.startingBalance)} />
          <DetailRow label="Current balance" value={formatMoney(account.balance)} />
          <DetailRow label="Phase" value={phase === "funded" ? "Funded" : "Challenge"} />
          <DetailRow label="Status" value={status} capitalize />
          <DetailRow label="Profit target" value={`${(profitTargetPct * 100).toFixed(0)}%`} />
          <DetailRow label="Leverage" value="1:100" last />
        </dl>
      </section>

      {/* Footer actions */}
      <section className="px-4 py-5">
        <form action={signOut}>
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm font-semibold text-[var(--loss)] transition-colors hover:bg-accent"
          >
            <LogOut className="h-4 w-4" />
            Log out
          </button>
        </form>
        <p className="mt-4 text-center text-[11px] text-muted-foreground">The People Prop Terminal · v1.0</p>
      </section>
    </div>
  )
}

function ActionTile({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Plus
  label: string
  value?: string
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-xl bg-secondary px-2 py-3 text-center">
      <Icon className="h-5 w-5 text-foreground" />
      {value ? (
        <>
          <span className="font-mono text-[11px] font-semibold tabular-nums">{value}</span>
          <span className="text-[10px] text-muted-foreground">{label}</span>
        </>
      ) : (
        <span className="text-[11px] font-medium">{label}</span>
      )}
    </div>
  )
}

function DetailRow({
  label,
  value,
  capitalize,
  last,
}: {
  label: string
  value: string
  capitalize?: boolean
  last?: boolean
}) {
  return (
    <div className={cn("flex items-center justify-between px-4 py-2.5", !last && "border-b border-border")}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={cn("font-mono text-sm font-semibold tabular-nums", capitalize && "capitalize")}>{value}</dd>
    </div>
  )
}
