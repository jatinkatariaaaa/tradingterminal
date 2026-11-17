"use client"

import { Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { TradingProvider } from "@/components/terminal/trading-provider"
import { TerminalShell } from "@/components/terminal/terminal-shell"
import { BreachModal } from "@/components/terminal/breach-modal"

/** A dashboard "Open terminal" link carries ?accountId=; otherwise the provider picks the newest live account. */
function TerminalPageContent() {
  const searchParams = useSearchParams()
  return (
    <TradingProvider initialAccountId={searchParams?.get("accountId") ?? null}>
      <TerminalShell />
      <BreachModal />
    </TradingProvider>
  )
}

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-[100dvh] bg-background" />}>
      <TerminalPageContent />
    </Suspense>
  )
}
