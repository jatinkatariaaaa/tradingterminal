"use client"

import { ExternalLink, LayoutDashboard, LogOut, RotateCw, Sparkles } from "lucide-react"
import { useIsMobileState } from "@/hooks/use-mobile"
import { signOut } from "@/app/(auth)/actions"
import { useTradingActions, useTradingState } from "./trading-provider"
import { CommandPalette } from "./shell/command-palette"
import { MobileShell } from "./mobile/mobile-shell"
import { DesktopShell } from "./desktop/desktop-shell"
import { SITE_URL, TppMark, TppTile } from "./brand"

/** Signed in, but no trading account yet: point the trader to the dashboard. */
function NoAccount({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <div className="relative flex min-h-[100dvh] flex-col overflow-hidden bg-background text-foreground">
      <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[720px] -translate-x-1/2 rounded-full bg-volt/10 blur-[110px]" />
      <header className="relative flex items-center justify-between px-5 pt-[max(env(safe-area-inset-top),18px)] pb-3">
        <span className="flex items-center gap-2.5">
          <TppTile />
          <span className="text-[14px] font-semibold tracking-tight">TPP Terminal</span>
        </span>
        <form action={signOut}>
          <button type="submit" className="flex h-9 items-center gap-1.5 rounded-full bg-secondary px-3.5 text-[12.5px] font-semibold text-muted-foreground hover:text-foreground">
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </form>
      </header>
      <main className="relative mx-auto flex w-full max-w-[440px] flex-1 flex-col justify-center px-6 pb-16">
        <TppMark className="h-7 text-foreground" />
        {error ? (
          <>
            <h1 className="mt-8 text-[30px] leading-[1.1] font-bold tracking-[-0.03em]">We couldn&apos;t load your accounts</h1>
            <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">The connection dropped while loading. Your accounts and open trades are safe on our servers; try again in a moment.</p>
          </>
        ) : (
          <>
            <h1 className="mt-8 text-[30px] leading-[1.1] font-bold tracking-[-0.03em]">No trading account on this login yet</h1>
            <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
              Accounts are issued from your dashboard the moment a challenge is paid. Pick an account type there, and it opens here automatically with its rules loaded.
            </p>
          </>
        )}
        <div className="mt-8 grid gap-2.5">
          {error ? (
            <button type="button" onClick={onRetry} className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-primary text-[15px] font-semibold text-primary-foreground">
              <RotateCw className="h-4 w-4" /> Try again
            </button>
          ) : null}
          <a href={`${SITE_URL}/dashboard/new-challenge`} className={error ? "flex h-12 items-center justify-center gap-2 rounded-2xl border border-border bg-card text-[15px] font-semibold" : "flex h-12 items-center justify-center gap-2 rounded-2xl bg-primary text-[15px] font-semibold text-primary-foreground transition-transform active:scale-[0.99]"}>
            <Sparkles className="h-4 w-4" /> Start a challenge
          </a>
          <a href={`${SITE_URL}/dashboard`} className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-border bg-card text-[15px] font-semibold">
            <LayoutDashboard className="h-4 w-4" /> Open dashboard
          </a>
          <a href={`${SITE_URL}/challenges`} className="mt-2 flex items-center justify-center gap-1.5 text-[13px] font-semibold text-muted-foreground hover:text-foreground">
            Compare account types <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </main>
    </div>
  )
}

function Loading() {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-background">
      <TppTile className="h-12 w-12 animate-pulse rounded-[15px]" />
      <p className="text-[13px] text-muted-foreground">Loading your accounts…</p>
    </div>
  )
}

export function TerminalShell() {
  const isMobile = useIsMobileState()
  const { accounts, accountsLoading, accountsError } = useTradingState()
  const { refreshAccounts } = useTradingActions()
  if (isMobile === undefined || (accountsLoading && accounts.length === 0)) return <Loading />
  if (accounts.length === 0) return <NoAccount error={accountsError} onRetry={() => void refreshAccounts()} />
  return (
    <>
      {isMobile ? <MobileShell /> : <DesktopShell />}
      {!isMobile && <CommandPalette />}
    </>
  )
}
