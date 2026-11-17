"use client"

import { useEffect, useState } from "react"
import { ArrowUpRight, ShieldX } from "lucide-react"
import { formatMoney } from "@/lib/trading/assets"
import { useTradingState } from "./trading-provider"
import { SITE_URL } from "./brand"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"

const SEEN_KEY = "tpp-breach-seen"

function seen(): string[] {
  try {
    return JSON.parse(window.sessionStorage.getItem(SEEN_KEY) || "[]")
  } catch {
    return []
  }
}

/**
 * Shown once per breached account and session. It can be closed, so the trader
 * can still read the account's history or switch to another account.
 */
export function BreachModal() {
  const { account, accountId } = useTradingState()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (account.status === "breached" && accountId && !seen().includes(accountId)) setOpen(true)
    else setOpen(false)
  }, [account.status, accountId])

  const close = () => {
    setOpen(false)
    if (!accountId) return
    try {
      window.sessionStorage.setItem(SEEN_KEY, JSON.stringify([...seen(), accountId]))
    } catch {
      // storage blocked: it shows again next time, which is harmless
    }
  }

  const result = account.balance - account.startingBalance
  const resetEligible = account.startingBalance >= 50_000

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
      <DialogContent className="rounded-2xl sm:max-w-[420px]">
        <DialogHeader className="items-center text-center">
          <span className="mb-1 grid h-12 w-12 place-items-center rounded-2xl bg-loss/12 text-loss">
            <ShieldX className="h-6 w-6" />
          </span>
          <DialogTitle className="text-[19px]">This account is breached</DialogTitle>
          <DialogDescription className="text-pretty">{account.breachReason || "A loss limit was reached. Open trades were closed and the account no longer accepts orders."}</DialogDescription>
        </DialogHeader>
        <dl className="grid gap-2 rounded-xl bg-secondary/60 p-3 text-[13px]">
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Final balance</dt>
            <dd className="font-mono font-semibold tabular-nums">{formatMoney(account.balance)}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Result</dt>
            <dd className={`font-mono font-semibold tabular-nums ${result >= 0 ? "text-profit" : "text-loss"}`}>
              {result >= 0 ? "+" : ""}
              {formatMoney(result)}
            </dd>
          </div>
        </dl>
        {resetEligible ? (
          <p className="rounded-xl border border-volt/40 bg-volt/[0.08] p-3 text-[12.5px] leading-relaxed">
            If this breach came within 24 hours of the account&apos;s first trade, it qualifies for a free reset. Claim it from your dashboard within 72 hours.
          </p>
        ) : null}
        <div className="grid gap-2">
          <a href={`${SITE_URL}/dashboard`} className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-primary text-[14px] font-semibold text-primary-foreground hover:opacity-90">
            Open dashboard <ArrowUpRight className="h-4 w-4" />
          </a>
          <button type="button" onClick={close} className="h-11 rounded-xl border border-border text-[14px] font-semibold hover:bg-secondary">
            Review this account&apos;s trades
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
