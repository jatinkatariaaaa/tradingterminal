"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Play } from "lucide-react"
import { cn } from "@/lib/utils"

export function TradeReplayLink({ accountId, symbol, className }: { accountId: string | null; symbol: string; className?: string }) {
  const [allowedAccount, setAllowedAccount] = useState<string | null>(null)
  useEffect(() => {
    if (!accountId) return
    const controller = new AbortController()
    const params = new URLSearchParams({ accountId })
    fetch("/api/trade-replays?" + params, { signal: controller.signal, cache: "no-store" })
      .then((response) => {
        if (!controller.signal.aborted) setAllowedAccount(response.status === 204 ? accountId : null)
      })
      .catch(() => {
        if (!controller.signal.aborted) setAllowedAccount(null)
      })
    return () => controller.abort()
  }, [accountId])

  if (!accountId || accountId !== allowedAccount) return null
  return (
    <Link href={"/trade-replays/" + accountId + "?" + new URLSearchParams({ symbol })} prefetch={false}
      className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold hover:bg-accent", className)}>
      <Play className="size-3" /> Trade Replay
    </Link>
  )
}
