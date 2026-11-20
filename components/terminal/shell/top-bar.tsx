"use client"

import { useEffect, useRef, useState } from "react"
import { BadgeCheck, LayoutDashboard, LogOut, PauseCircle, Search, ShieldAlert, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatMoney } from "@/lib/trading/assets"
import { signOut } from "@/app/(auth)/actions"
import { useMarket, useTradingState } from "../trading-provider"
import { AccountSwitcher } from "../account-switcher"
import { SITE_URL, TppTile } from "../brand"
import { ThemeToggle } from "../theme-toggle"
import { openPalette } from "../desktop/events"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"
import { CreateTradeRecordModal } from "../create-trade-record-modal"

/** One account figure; flashes briefly when the value moves. */
function Metric({ label, value, tone = "default", flashKey }: { label: string; value: string; tone?: "default" | "profit" | "loss"; flashKey?: number }) {
  const prev = useRef(flashKey)
  const [flash, setFlash] = useState<"up" | "down" | null>(null)
  useEffect(() => {
    if (flashKey === undefined || prev.current === undefined) {
      prev.current = flashKey
      return
    }
    if (flashKey > prev.current) setFlash("up")
    else if (flashKey < prev.current) setFlash("down")
    prev.current = flashKey
    const t = setTimeout(() => setFlash(null), 600)
    return () => clearTimeout(t)
  }, [flashKey])

  return (
    <div className={cn("flex flex-col justify-center rounded-lg px-3 py-1", flash === "up" && "flash-up", flash === "down" && "flash-down")}>
      <span className="text-[10px] font-semibold tracking-[0.08em] whitespace-nowrap text-muted-foreground uppercase">{label}</span>
      <span className={cn("font-mono text-[13.5px] leading-tight font-semibold whitespace-nowrap tabular-nums", tone === "profit" && "text-profit", tone === "loss" && "text-loss")}>{value}</span>
    </div>
  )
}

/** Loss-limit room for the day or overall: how much is left, with a bar that warms up as it fills. */
function RiskGauge({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0
  const left = Math.max(0, limit - used)
  const tone = pct >= 75 ? "bg-loss" : pct >= 45 ? "bg-warning" : "bg-profit"
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex w-[150px] flex-col gap-1 px-1" aria-label={`${label}: ${formatMoney(left)} left`}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[10px] font-semibold tracking-[0.06em] whitespace-nowrap text-muted-foreground uppercase">{label}</span>
            <span className={cn("font-mono text-[11px] font-semibold whitespace-nowrap tabular-nums", pct >= 75 && "text-loss")}>{formatMoney(left)}</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-secondary">
            <div className={cn("h-full rounded-full transition-[width] duration-500", tone)} style={{ width: `${Math.max(pct, 2)}%` }} />
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="font-mono text-xs tabular-nums">
        {formatMoney(used)} used of {formatMoney(limit)} · {pct.toFixed(0)}%
      </TooltipContent>
    </Tooltip>
  )
}

const STATUS_CHIP: Record<string, { label: string; tone: string; icon: typeof ShieldAlert }> = {
  breached: { label: "Breached", tone: "bg-loss/15 text-loss", icon: ShieldAlert },
  passed: { label: "Passed", tone: "bg-profit/15 text-profit", icon: BadgeCheck },
  suspended: { label: "Paused", tone: "bg-warning/15 text-warning", icon: PauseCircle },
}

function IconLink({ label, children, href, onClick }: { label: string; children: React.ReactNode; href?: string; onClick?: () => void }) {
  const cls = "grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {href ? (
          <a href={href} aria-label={label} className={cls}>
            {children}
          </a>
        ) : (
          <button type="button" onClick={onClick} aria-label={label} className={cls}>
            {children}
          </button>
        )}
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export function TopBar() {
  const { derived } = useMarket()
  const { account, accountId } = useTradingState()
  const [isAdmin, setIsAdmin] = useState(false)
  const [showRecordModal, setShowRecordModal] = useState(false)

  useEffect(() => {
    try {
      const supabase = createSupabaseBrowserClient()
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (!user) return
        Promise.all([
          supabase.from("profiles").select("is_admin").eq("id", user.id).maybeSingle(),
          supabase.from("admin_roles").select("role").eq("user_id", user.id).maybeSingle(),
        ]).then(([{ data: p }, { data: r }]) => {
          if (p?.is_admin || r?.role) setIsAdmin(true)
        }).catch(() => {})
      }).catch(() => {})
    } catch {}
  }, [])

  const pnl = derived.floatingPnl
  const chip = STATUS_CHIP[account.status]

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card pr-3">
      <a href={SITE_URL} className="grid w-[52px] shrink-0 place-items-center" title="The People Prop">
        <TppTile />
      </a>
      <AccountSwitcher />
      <span className="mx-1 h-8 w-px shrink-0 bg-border" />

      <div className="flex min-w-0 items-center overflow-x-auto scrollbar-none">
        <Metric label="Balance" value={formatMoney(account.balance)} />
        <Metric label="Equity" value={formatMoney(derived.equity)} flashKey={Math.round(derived.equity * 100)} />
        <Metric label="Floating P/L" value={`${pnl > 0 ? "+" : ""}${formatMoney(pnl)}`} tone={pnl > 0 ? "profit" : pnl < 0 ? "loss" : "default"} flashKey={Math.round(pnl * 100)} />
        <Metric label="Free margin" value={formatMoney(derived.freeMargin)} />
        <Metric
          label="Margin level"
          value={derived.marginLevel == null ? "—" : `${derived.marginLevel.toLocaleString("en-US", { maximumFractionDigits: 0 })}%`}
          tone={derived.marginLevel != null && derived.marginLevel < 150 ? "loss" : "default"}
        />
      </div>

      <span className="mx-1 hidden h-8 w-px shrink-0 bg-border min-[1380px]:block" />
      <div className="hidden shrink-0 items-center gap-3 min-[1380px]:flex">
        <RiskGauge label="Daily loss" used={derived.dailyDrawdownUsed} limit={derived.dailyDrawdownLimit} />
        <RiskGauge label="Max loss" used={derived.maxDrawdownUsed} limit={derived.maxDrawdownLimit} />
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1">
        {chip ? (
          <span className={cn("mr-1 flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold", chip.tone)}>
            <chip.icon className="h-3.5 w-3.5" />
            {chip.label}
          </span>
        ) : null}
        {isAdmin && accountId && (
          <button
            type="button"
            onClick={() => setShowRecordModal(true)}
            className="mr-1 flex h-9 items-center gap-1.5 rounded-full bg-volt px-3 text-[12px] font-bold text-volt-foreground shadow-sm transition-all hover:opacity-90 active:scale-95 cursor-pointer"
            title="Create historical demo trade records"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Create Trades Records</span>
          </button>
        )}
        <button
          type="button"
          onClick={openPalette}
          className="mr-1 flex h-9 items-center gap-2 rounded-full border border-border bg-background/60 pr-2 pl-3 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Search symbols and actions"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="hidden min-[1600px]:inline">Search markets</span>
          <kbd className="rounded-md border border-border bg-secondary px-1.5 font-mono text-[10.5px] font-semibold">Ctrl K</kbd>
        </button>
        <IconLink label="Dashboard" href={`${SITE_URL}/dashboard`}>
          <LayoutDashboard className="h-4 w-4" />
        </IconLink>
        <ThemeToggle />
        <IconLink label="Sign out" onClick={() => void signOut()}>
          <LogOut className="h-4 w-4" />
        </IconLink>
      </div>

      {showRecordModal && accountId && (
        <CreateTradeRecordModal
          open={showRecordModal}
          onClose={() => setShowRecordModal(false)}
          accountId={accountId}
        />
      )}
    </header>
  )
}
