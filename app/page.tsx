"use client"

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useServerAccounts } from "@/hooks/use-server-accounts"
import { TradingProvider } from "@/components/terminal/trading-provider"
import { TerminalShell } from "@/components/terminal/terminal-shell"
import { BreachModal } from "@/components/terminal/breach-modal"

function TerminalPageContent() {
  const searchParams = useSearchParams()
  const { accounts } = useServerAccounts()
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)

  useEffect(() => {
    // 1. Try URL parameter accountId first
    const urlAccountId = searchParams?.get("accountId")
    if (urlAccountId) {
      setSelectedAccountId(urlAccountId)
      return
    }

    // 2. Try the first active/funded account from useServerAccounts
    const active = accounts.find(
      (a) => a.status === "active" || a.status === "funded",
    )
    if (active) {
      setSelectedAccountId(active.id)
    }
  }, [searchParams, accounts])

  return (
    <TradingProvider initialAccountId={selectedAccountId}>
      <TerminalShell />
      <BreachModal />
    </TradingProvider>
  )
}

export default function Page() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center bg-background text-sm text-muted-foreground">Loading terminal...</div>}>
      <TerminalPageContent />
    </Suspense>
  )
}
