"use client"

import { useEffect, useState } from "react"
import { useTheme } from "next-themes"
import { BookOpen, ChevronRight, Copy, CopyCheck, LayoutDashboard, LifeBuoy, LogOut, Moon, Sun, Wallet } from "lucide-react"
import { cn } from "@/lib/utils"
import { signOut } from "@/app/(auth)/actions"
import { useMarket, useTradingState } from "../trading-provider"
import { AccountList, accountTitle } from "../account-switcher"
import { Objectives } from "../objectives"
import { SITE_URL, TppTile } from "../brand"
import { money } from "../kit"
import { ScreenHeader, SectionLabel } from "./ui"

const PROGRAM: Record<string, string> = {
  "1-step": "1-Step",
  "2-step": "2-Step",
  "3-step": "3-Step",
  instant: "Instant Funding",
  access: "Access",
}

const STATUS: Record<string, { label: string; tone: string }> = {
  active: { label: "Evaluation", tone: "bg-buy/12 text-buy" },
  funded: { label: "Funded", tone: "bg-volt/20 text-volt-ink" },
  passed: { label: "Passed", tone: "bg-sky-500/12 text-sky-500" },
  breached: { label: "Breached", tone: "bg-sell/12 text-sell" },
  suspended: { label: "Paused", tone: "bg-warning/15 text-warning" },
  none: { label: "No account", tone: "bg-secondary text-muted-foreground" },
}

function ThemeSwitch() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const dark = !mounted || resolvedTheme !== "light"
  return (
    <div className="flex rounded-full bg-secondary p-1" role="radiogroup" aria-label="Theme">
      {(
        [
          ["dark", Moon, "Dark"],
          ["light", Sun, "Light"],
        ] as const
      ).map(([key, Icon, label]) => {
        const on = key === "dark" ? dark : !dark
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => setTheme(key)}
            className={cn("flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold transition-colors", on ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        )
      })}
    </div>
  )
}

const LINKS = [
  { href: "/dashboard", label: "Dashboard", hint: "Accounts, certificates, stipend", icon: LayoutDashboard },
  { href: "/dashboard/payouts", label: "Payouts", hint: "Request and track withdrawals", icon: Wallet },
  { href: "/rules", label: "Trading rules", hint: "Every rule, per account type", icon: BookOpen },
  { href: "/faqs", label: "Help centre", hint: "Answers and live support", icon: LifeBuoy },
]

export function AccountScreen() {
  const { quoteLive } = useMarket()
  const { account, accounts, accountId } = useTradingState()
  const [copied, setCopied] = useState(false)
  const current = accounts.find((a) => a.id === accountId)
  const st = STATUS[account.status] ?? STATUS.none

  const copyId = async () => {
    if (!current) return
    try {
      await navigator.clipboard.writeText(current.id)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard blocked
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScreenHeader title="Account" />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-10">
        <div className="px-4">
          <div className="rounded-[20px] border border-border bg-card p-4">
            <div className="flex items-center gap-3">
              <TppTile className="h-11 w-11 rounded-[14px]" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[16px] font-bold tracking-tight">{current ? accountTitle(current) : "No account selected"}</p>
                <p className="truncate text-[12.5px] text-muted-foreground">{current?.programKey ? `${PROGRAM[current.programKey] ?? current.programKey} program` : "The People Prop"}</p>
              </div>
              <span className={cn("rounded-full px-2.5 py-1 text-[11.5px] font-semibold", st.tone)}>{st.label}</span>
            </div>
            {current ? (
              <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-border pt-3">
                <div>
                  <dt className="text-[11px] text-muted-foreground">Size</dt>
                  <dd className="font-mono text-[13px] font-semibold tabular-nums">{money(current.startingBalance).replace(".00", "")}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-muted-foreground">Leverage</dt>
                  <dd className="font-mono text-[13px] font-semibold tabular-nums">1:{current.leverage}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-muted-foreground">Login</dt>
                  <dd>
                    <button type="button" onClick={copyId} className="flex items-center gap-1 font-mono text-[13px] font-semibold tabular-nums">
                      {current.id.slice(0, 8)}
                      {copied ? <CopyCheck className="h-3.5 w-3.5 text-profit" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
                    </button>
                  </dd>
                </div>
              </dl>
            ) : null}
          </div>
        </div>

        <SectionLabel>Objectives</SectionLabel>
        <div className="px-4">
          <Objectives compact />
        </div>

        <SectionLabel>Your accounts</SectionLabel>
        <div className="mx-4 rounded-[20px] border border-border bg-card p-1.5">
          <AccountList />
        </div>

        <SectionLabel>Settings</SectionLabel>
        <div className="mx-4 divide-y divide-border rounded-[20px] border border-border bg-card">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="text-[14px] font-medium">Theme</span>
            <ThemeSwitch />
          </div>
          <div className="flex items-center justify-between gap-3 px-4 py-3.5">
            <span className="text-[14px] font-medium">Price feed</span>
            <span className={cn("flex items-center gap-1.5 text-[13px] font-semibold", quoteLive ? "text-profit" : "text-muted-foreground")}>
              <span className={cn("h-2 w-2 rounded-full", quoteLive ? "bg-profit" : "bg-muted-foreground")} />
              {quoteLive ? "Live" : "No live quote"}
            </span>
          </div>
        </div>

        <SectionLabel>The People Prop</SectionLabel>
        <ul className="mx-4 divide-y divide-border rounded-[20px] border border-border bg-card">
          {LINKS.map((l) => (
            <li key={l.href}>
              <a href={`${SITE_URL}${l.href}`} target="_blank" rel="noreferrer" className="flex items-center gap-3 px-4 py-3 active:bg-accent">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-secondary">
                  <l.icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-medium">{l.label}</span>
                  <span className="block truncate text-[12px] text-muted-foreground">{l.hint}</span>
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </a>
            </li>
          ))}
        </ul>

        <div className="mx-4 mt-5">
          <form action={signOut}>
            <button type="submit" className="flex h-12 w-full items-center justify-center gap-2 rounded-[16px] bg-sell/10 text-[14px] font-semibold text-sell active:bg-sell/20">
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </form>
          <p className="mt-4 text-center text-[11.5px] leading-relaxed text-muted-foreground">
            TPP Terminal · simulated trading environment
            <br />
            Trading involves risk. Past performance does not guarantee future results.
          </p>
        </div>
      </div>
    </div>
  )
}
