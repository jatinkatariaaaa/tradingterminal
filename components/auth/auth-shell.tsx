import type { ReactNode } from "react"
import { BadgePercent, CalendarClock, RotateCcw } from "lucide-react"
import { TppMark, TppTile } from "@/components/terminal/brand"

const PERKS = [
  { icon: BadgePercent, title: "1% monthly stipend", body: "Every active account earns 1% of its size each month while it trades." },
  { icon: CalendarClock, title: "First 5 payouts on demand", body: "Request your first five payouts whenever you are in profit, no cycle to wait out." },
  { icon: RotateCcw, title: "24-hour free reset", body: "A $50K or larger account that fails inside its first 24 hours gets one free reset." },
]

/** Sign-in layout: the brand panel on wide screens, the form on its own on phones. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh bg-background">
      <section aria-hidden="true" className="relative hidden w-[46%] flex-col justify-between overflow-hidden bg-[oklch(0.15_0.006_165)] p-12 text-white lg:flex">
        <div className="pointer-events-none absolute -top-48 -left-40 h-[560px] w-[560px] rounded-full bg-[oklch(0.93_0.2_125/0.12)] blur-[120px]" />
        <div className="pointer-events-none absolute right-[-120px] bottom-[-160px] h-[420px] w-[420px] rounded-full bg-[oklch(0.55_0.1_165/0.25)] blur-[120px]" />

        <div className="relative flex items-center gap-3">
          <TppMark className="h-6 text-white" />
          <span className="h-4 w-px bg-white/20" />
          <span className="text-[13px] font-semibold tracking-tight text-white/70">Terminal</span>
        </div>

        <div className="relative max-w-[440px]">
          <h2 className="text-[40px] leading-[1.05] font-bold tracking-[-0.035em]">Trade the account you earned.</h2>
          <p className="mt-4 text-[15px] leading-relaxed text-white/60">
            TPP Terminal runs every account The People Prop issues: live quotes, one-tap orders, and your rules tracked to the cent.
          </p>
          <ul className="mt-10 grid gap-5">
            {PERKS.map((p) => (
              <li key={p.title} className="flex items-start gap-3.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/[0.07] text-[oklch(0.93_0.2_125)] ring-1 ring-white/10">
                  <p.icon className="h-4 w-4" />
                </span>
                <span>
                  <span className="block text-[14px] font-semibold">{p.title}</span>
                  <span className="mt-0.5 block text-[13px] leading-relaxed text-white/55">{p.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-[12px] text-white/40">Simulated trading environment. Program rules apply to every account.</p>
      </section>

      <section className="flex w-full flex-col items-center justify-center px-5 py-10 lg:w-[54%]">
        <div className="mb-10 flex items-center gap-2.5 lg:hidden">
          <TppTile className="h-10 w-10 rounded-[13px]" />
          <span className="text-[16px] font-semibold tracking-tight">TPP Terminal</span>
        </div>
        {children}
      </section>
    </main>
  )
}

/** Labelled input for the sign-in form. */
export function AuthField({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1.5 text-[13px] font-medium text-foreground">
      {label}
      <input
        {...props}
        className="h-12 rounded-xl border border-border bg-card px-4 text-[15px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-4 focus:ring-ring/15"
      />
    </label>
  )
}
