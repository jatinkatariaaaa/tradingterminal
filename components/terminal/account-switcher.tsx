"use client"

import { useEffect, useRef, useState } from "react"
import { Check, ChevronDown, ExternalLink, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ServerAccount } from "@/lib/trading/account"
import { useTradingActions, useTradingState } from "./trading-provider"
import { SITE_URL } from "./brand"

const STATUS: Record<string, { label: string; dot: string }> = {
  active: { label: "Evaluation", dot: "bg-buy" },
  funded: { label: "Funded", dot: "bg-volt" },
  passed: { label: "Passed", dot: "bg-sky-400" },
  breached: { label: "Breached", dot: "bg-sell" },
  suspended: { label: "Paused", dot: "bg-warning" },
}

const size = (n: number) => (n >= 1000 ? `$${(n / 1000).toLocaleString("en-US")}K` : `$${n}`)

export function accountTitle(a: Pick<ServerAccount, "startingBalance" | "phase" | "label">) {
  return a.label?.trim() || `${size(a.startingBalance)} ${a.phase === "funded" ? "Funded" : "Evaluation"}`
}

/** The account list: as a dropdown in the desktop bar, or as a plain list on mobile. */
export function AccountList({ onPick, className }: { onPick?: () => void; className?: string }) {
  const { accounts, accountId } = useTradingState()
  const { setAccountId } = useTradingActions()
  const sorted = [...accounts].sort((a, b) => {
    const live = (s: string) => (s === "active" || s === "funded" ? 0 : 1)
    return live(a.status) - live(b.status) || +new Date(b.createdAt) - +new Date(a.createdAt)
  })
  return (
    <ul className={cn("grid gap-1", className)}>
      {sorted.map((a) => {
        const st = STATUS[a.status] ?? { label: a.status, dot: "bg-muted-foreground" }
        const on = a.id === accountId
        return (
          <li key={a.id}>
            <button
              type="button"
              onClick={() => {
                setAccountId(a.id)
                onPick?.()
              }}
              className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors", on ? "bg-accent" : "hover:bg-accent/60")}
            >
              <span className={cn("h-2 w-2 shrink-0 rounded-full", st.dot)} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-semibold">{accountTitle(a)}</span>
                <span className="block text-[11.5px] text-muted-foreground">
                  {st.label} · #{a.id.slice(0, 8)} · 1:{a.leverage}
                </span>
              </span>
              <span className="font-mono text-[12.5px] tabular-nums text-muted-foreground">{size(a.startingBalance)}</span>
              {on ? <Check className="h-4 w-4 text-volt-ink" /> : null}
            </button>
          </li>
        )
      })}
      <li>
        <a href={`${SITE_URL}/dashboard/new-challenge`} target="_blank" rel="noreferrer" className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-semibold text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground">
          <Plus className="h-4 w-4" /> New account
          <ExternalLink className="ml-auto h-3.5 w-3.5" />
        </a>
      </li>
    </ul>
  )
}

export function AccountSwitcher({ className }: { className?: string }) {
  const { accounts, accountId } = useTradingState()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [])

  const current = accounts.find((a) => a.id === accountId)
  const st = current ? (STATUS[current.status] ?? STATUS.active) : null

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex h-9 max-w-[260px] items-center gap-2 rounded-full border border-border bg-secondary/70 pr-2.5 pl-3 text-left transition-colors hover:bg-secondary">
        {st ? <span className={cn("h-2 w-2 shrink-0 rounded-full", st.dot)} /> : null}
        <span className="min-w-0 truncate text-[12.5px] font-semibold">{current ? accountTitle(current) : accounts.length ? "Select account" : "No account"}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="absolute top-full left-0 z-50 mt-2 w-[340px] rounded-2xl border border-border bg-popover p-1.5 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.55)]">
          <AccountList onPick={() => setOpen(false)} />
        </div>
      ) : null}
    </div>
  )
}
