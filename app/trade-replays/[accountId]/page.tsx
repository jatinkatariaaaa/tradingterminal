import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { TradeReplayStudio } from "@/components/terminal/replay/replay-studio"
import { AdminAuthError } from "@/lib/admin-auth"
import { listReplays, requireReplayAccount } from "@/lib/trading/replay-store"

export const metadata = { title: "Trade Replay · TPP Terminal", robots: { index: false, follow: false } }

export default async function TradeReplaysPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>
  searchParams: Promise<{ symbol?: string }>
}) {
  const [{ accountId }, { symbol }] = await Promise.all([params, searchParams])
  const access = await requireReplayAccount(accountId).catch((error: unknown) => {
    if (error instanceof AdminAuthError) notFound()
    throw error
  })
  const replays = await listReplays(accountId, access)
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-8">
        <Link href={"/?accountId=" + accountId} className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Back to terminal
        </Link>
        <header className="mb-6 mt-5">
          <p className="text-sm font-medium text-muted-foreground">{access.account.label}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Trade Replay</h1>
          <p className="mt-2 text-sm text-muted-foreground">Build a teaching example from historical candles. Replay P&amp;L is hypothetical.</p>
        </header>
        <TradeReplayStudio accountId={accountId} initialSymbol={symbol} replays={replays} />
      </div>
    </main>
  )
}
