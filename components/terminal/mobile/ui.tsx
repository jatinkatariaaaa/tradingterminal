"use client"

import type { ComponentType, ReactNode } from "react"
import { cn } from "@/lib/utils"

/* Pieces every mobile screen shares: the large-title header, round icon buttons, section labels. */

export function ScreenHeader({ title, right, children, className }: { title: ReactNode; right?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <header className={cn("shrink-0 bg-background px-4 pt-[max(env(safe-area-inset-top),8px)]", className)}>
      <div className="flex h-12 items-center justify-between gap-3">
        <h1 className="min-w-0 truncate text-[24px] font-bold tracking-[-0.02em]">{title}</h1>
        {right ? <div className="flex shrink-0 items-center gap-1.5">{right}</div> : null}
      </div>
      {children}
    </header>
  )
}

export function IconBtn({
  icon: Icon,
  label,
  onClick,
  active,
  tone,
  disabled,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  onClick?: () => void
  active?: boolean
  tone?: "sell"
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      disabled={disabled}
      className={cn(
        "grid h-9 w-9 place-items-center rounded-full transition-colors disabled:opacity-40",
        active ? "bg-primary text-primary-foreground" : tone === "sell" ? "bg-sell/12 text-sell" : "bg-secondary text-foreground active:bg-accent",
      )}
    >
      <Icon className="h-[18px] w-[18px]" />
    </button>
  )
}

export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 pt-5 pb-2">
      <h2 className="text-[12px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">{children}</h2>
      {right}
    </div>
  )
}

export function Empty({ icon: Icon, title, text, action }: { icon: ComponentType<{ className?: string }>; title: string; text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-8 py-10 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-secondary text-muted-foreground">
        <Icon className="h-5 w-5" />
      </span>
      <p className="mt-3 text-[15px] font-semibold">{title}</p>
      <p className="mt-1 max-w-[260px] text-[13px] leading-relaxed text-muted-foreground">{text}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

/** Chip row used for categories and periods; scrolls sideways when it runs out of room. */
export function Chips<T extends string>({ value, options, onChange, className }: { value: T; options: { key: T; label: ReactNode }[]; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cn("-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 scrollbar-none", className)}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          aria-pressed={value === o.key}
          className={cn(
            "flex h-8 shrink-0 items-center gap-1 rounded-full px-3.5 text-[13px] font-semibold whitespace-nowrap transition-colors",
            value === o.key ? "bg-foreground text-background" : "bg-secondary text-muted-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

const pad = (n: number) => String(n).padStart(2, "0")

/** MT5's timestamp style: 2026.11.17 14:05:09 (local time). */
export function stamp(ts: number, withSeconds = true) {
  const d = new Date(ts)
  const date = `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}${withSeconds ? `:${pad(d.getSeconds())}` : ""}`
  return `${date} ${time}`
}

export function duration(ms: number) {
  const m = Math.max(0, Math.round(ms / 60000))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}
