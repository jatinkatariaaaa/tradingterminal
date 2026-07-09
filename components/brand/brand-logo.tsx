import { cn } from "@/lib/utils"

/**
 * The People Prop brand mark: three ascending candle-people.
 * Reads as both a rising chart and a community of traders — the tall accent
 * figure is the funded trader. Inherits `currentColor` for the base figures
 * so it adapts to light/dark themes; the lead figure uses the profit green.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" aria-hidden="true" className={cn("h-7 w-7", className)}>
      {/* Figure 1 (short) */}
      <circle cx="10" cy="27" r="3.4" fill="currentColor" />
      <rect x="6.6" y="32.4" width="6.8" height="11.6" rx="3.4" fill="currentColor" />
      {/* Figure 2 (medium) */}
      <circle cx="24" cy="19" r="3.4" fill="currentColor" />
      <rect x="20.6" y="24.4" width="6.8" height="19.6" rx="3.4" fill="currentColor" />
      {/* Figure 3 (tall, accent = the funded trader) */}
      <circle cx="38" cy="11" r="3.4" fill="var(--profit, #10B981)" />
      <rect x="34.6" y="16.4" width="6.8" height="27.6" rx="3.4" fill="var(--profit, #10B981)" />
    </svg>
  )
}

/**
 * Full lockup: mark + wordmark. "PROP" carries the accent so the name lands
 * with the same one-accent discipline used by FTMO / FundedNext / The5ers.
 */
export function BrandLogo({
  className,
  markClassName,
  subtitle,
}: {
  className?: string
  markClassName?: string
  subtitle?: string
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <BrandMark className={markClassName} />
      <div className="flex flex-col leading-none">
        <span className="text-sm font-bold uppercase tracking-tight">
          The People{" "}
          <span style={{ color: "var(--profit, #10B981)" }}>Prop</span>
        </span>
        {subtitle ? (
          <span className="mt-0.5 text-[9px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {subtitle}
          </span>
        ) : null}
      </div>
    </div>
  )
}
