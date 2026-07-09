import type { ReactNode } from "react"
import { TrendingUp, ShieldCheck, Zap, BarChart3 } from "lucide-react"

const FEATURES = [
  {
    icon: BarChart3,
    title: "Institutional-grade terminal",
    body: "Live charts, one-click execution, and pro risk tools.",
  },
  {
    icon: ShieldCheck,
    title: "Transparent evaluation",
    body: "Clear drawdown rules with real-time breach monitoring.",
  },
  {
    icon: Zap,
    title: "Instant execution",
    body: "Market, limit, and stop orders with live margin preview.",
  },
]

/**
 * Split-panel shell shared by the login and signup pages.
 * Left: brand panel (hidden on mobile). Right: the form card.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh bg-background">
      {/* Brand panel */}
      <section
        aria-hidden="true"
        className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-sidebar p-10 lg:flex"
      >
        {/* Subtle candlestick-style backdrop */}
        <div className="pointer-events-none absolute inset-0 opacity-[0.05]">
          <svg className="h-full w-full" viewBox="0 0 400 400" preserveAspectRatio="xMidYMid slice">
            {[
              [20, 210, 60, 120],
              [60, 180, 90, 90],
              [100, 230, 40, 150],
              [140, 160, 100, 70],
              [180, 200, 70, 120],
              [220, 140, 110, 60],
              [260, 190, 80, 110],
              [300, 120, 130, 40],
              [340, 170, 90, 90],
            ].map(([x, y, h, wick], i) => (
              <g key={i} stroke="currentColor" fill={i % 3 === 0 ? "none" : "currentColor"}>
                <line x1={x + 12} y1={wick} x2={x + 12} y2={y + h + 30} strokeWidth="2" />
                <rect x={x} y={y} width="24" height={h} strokeWidth="2" rx="2" />
              </g>
            ))}
          </svg>
        </div>

        <div className="relative flex items-center gap-3">
          <BrandMark className="h-9 w-9 text-sidebar-foreground" />
          <span className="text-lg font-bold uppercase tracking-tight text-sidebar-foreground">
            The People <span style={{ color: "var(--profit, #10B981)" }}>Prop</span>
          </span>
        </div>

        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight text-sidebar-foreground text-balance">
            Trade our capital. Keep the upside.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Pass the evaluation on a professional terminal built for serious traders.
          </p>

          <ul className="mt-8 flex flex-col gap-5">
            {FEATURES.map((f) => (
              <li key={f.title} className="flex items-start gap-3.5">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-card text-primary">
                  <f.icon className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-medium text-sidebar-foreground">{f.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{f.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-muted-foreground">
          Simulated trading environment. Evaluation rules apply.
        </p>
      </section>

      {/* Form panel */}
      <section className="flex w-full flex-col items-center justify-center px-4 py-10 lg:w-1/2">
        {/* Mobile brand mark */}
        <div className="mb-8 flex items-center gap-3 lg:hidden">
          <BrandMark className="h-9 w-9 text-foreground" />
          <span className="text-lg font-bold uppercase tracking-tight">
            The People <span style={{ color: "var(--profit, #10B981)" }}>Prop</span>
          </span>
        </div>
        {children}
      </section>
    </main>
  )
}

/** Consistent labelled input for the auth forms. */
export function AuthField({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1.5 text-xs font-medium text-foreground">
      {label}
      <input
        {...props}
        className="h-11 rounded-lg border border-border bg-background px-3.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
      />
    </label>
  )
}
