"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { formatPrice } from "@/lib/trading/assets"
import type { ClosedTrade, OpenPosition } from "@/lib/trading/types"

/* Small pieces shared by the mobile screens and the desktop panels. */

/** MT5-style quote: the leading digits small, the two pip digits large, the last digit raised. */
export function BigPrice({ price, digits, className, tone }: { price: number; digits: number; className?: string; tone?: "up" | "down" | null }) {
  const text = formatPrice(price, digits)
  let head = text
  let big = ""
  let tail = ""
  if (digits >= 3) {
    head = text.slice(0, -3)
    big = text.slice(-3, -1)
    tail = text.slice(-1)
  } else if (digits >= 1) {
    head = text.slice(0, -2)
    big = text.slice(-2)
  }
  return (
    <span className={cn("inline-flex items-baseline font-mono tabular-nums", tone === "up" ? "text-buy" : tone === "down" ? "text-sell" : "text-foreground", className)}>
      <span className="text-[0.62em] font-medium">{head}</span>
      <span className="text-[1em] font-semibold leading-none">{big}</span>
      {tail ? <sup className="ml-[1px] text-[0.5em] font-semibold">{tail}</sup> : null}
    </span>
  )
}

/** Direction of the last tick, cleared after a moment, for flashing quotes. */
export function useTick(value: number): "up" | "down" | null {
  const prev = useRef(value)
  const [dir, setDir] = useState<"up" | "down" | null>(null)
  useEffect(() => {
    if (value > prev.current) setDir("up")
    else if (value < prev.current) setDir("down")
    prev.current = value
    const t = setTimeout(() => setDir(null), 700)
    return () => clearTimeout(t)
  }, [value])
  return dir
}

export const money = (n: number, opts: { sign?: boolean } = {}) => {
  const s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const sign = n < 0 ? "-" : opts.sign && n > 0 ? "+" : ""
  return `${sign}$${s}`
}

export const pnlTone = (n: number) => (n > 0 ? "text-profit" : n < 0 ? "text-loss" : "text-muted-foreground")

export function DirChip({ direction, className }: { direction: "buy" | "sell"; className?: string }) {
  return (
    <span className={cn("rounded-[5px] px-1.5 py-[1px] text-[10px] font-bold tracking-wide uppercase", direction === "buy" ? "bg-buy/15 text-buy" : "bg-sell/15 text-sell", className)}>
      {direction}
    </span>
  )
}

/** Label / value row used in account summaries. */
export function Row({ label, value, tone, className }: { label: ReactNode; value: ReactNode; tone?: string; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-4 py-2.5", className)}>
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <span className={cn("font-mono text-[13.5px] font-semibold tabular-nums", tone)}>{value}</span>
    </div>
  )
}

/** Trading session key: sessions roll over at 5pm New York, like the engine. */
export function sessionKey(ts: number): string {
  const ny = new Date(new Date(ts).toLocaleString("en-US", { timeZone: "America/New_York" }))
  ny.setHours(ny.getHours() + 7)
  return `${ny.getFullYear()}-${ny.getMonth() + 1}-${ny.getDate()}`
}

/** Distinct sessions with at least one opened trade (closed or still open). */
export function tradingDays(closed: ClosedTrade[], open: OpenPosition[]): number {
  const keys = new Set<string>()
  for (const t of closed) keys.add(sessionKey(t.openedAt))
  for (const p of open) keys.add(sessionKey(p.openedAt))
  return keys.size
}

export function Meter({ value, tone }: { value: number; tone: "volt" | "buy" | "sell" | "warning" }) {
  const color = { volt: "bg-volt", buy: "bg-buy", sell: "bg-sell", warning: "bg-warning" }[tone]
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
      <div className={cn("h-full rounded-full transition-[width] duration-500", color)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  )
}
