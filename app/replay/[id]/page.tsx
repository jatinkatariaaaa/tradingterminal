import { notFound } from "next/navigation"
import { ReplayChart } from "@/components/terminal/replay/replay-chart"
import { formatPrice, getAsset } from "@/lib/trading/assets"
import { REPLAY_OUTCOME, REPLAY_TIMEFRAMES, replayPnl, replayTime } from "@/lib/trading/replay"
import { getSharedReplay } from "@/lib/trading/replay-store"

export const dynamic = "force-dynamic"
export const metadata = {
  title: "Trade Replay · The People Prop",
  description: "An educational scenario using historical candles and hypothetical P&L.",
  robots: { index: false, follow: false },
}

export default async function SharedReplayPage({ params }: { params: Promise<{ id: string }> }) {
  const saved = await getSharedReplay((await params).id)
  if (!saved) notFound()
  const { replay, candles } = saved
  const asset = getAsset(replay.symbol)
  const timeframe = REPLAY_TIMEFRAMES.find((tf) => tf.seconds === replay.timeframe)?.label
  const fields = [
    ["Direction", replay.direction === "buy" ? "Buy" : "Sell"],
    ["Entry", formatPrice(replay.entry, asset.digits)],
    ["Stop-loss", formatPrice(replay.stopLoss, asset.digits)],
    ["Target", formatPrice(replay.target, asset.digits)],
    ["Size", replay.lots + " lots"],
    ["Hypothetical P&L", replayPnl(replay)],
  ]
  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-8">
      <article className="mx-auto max-w-5xl space-y-5">
        <header>
          <p className="text-sm font-semibold text-muted-foreground">The People Prop · Trade Replay</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">{replay.symbol} · {timeframe}</h1>
          <p className="mt-2 text-sm text-muted-foreground">Historical teaching example · Hypothetical P&amp;L</p>
        </header>
        <section aria-label="Historical chart" className="overflow-hidden rounded-2xl border border-border bg-card">
          <ReplayChart
            candles={candles}
            digits={asset.digits}
            entryTime={replay.entryTime}
            entry={replay.entry}
            stopLoss={replay.stopLoss}
            target={replay.target}
            outcomeTime={replay.outcomeTime}
          />
        </section>
        <dl className="grid grid-cols-2 gap-4 rounded-2xl border border-border bg-card p-4 sm:grid-cols-3 sm:p-5">
          {fields.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
              <dd className="mt-1 font-mono text-sm font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
        <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
          <h2 className="font-semibold">{REPLAY_OUTCOME[replay.outcome]}</h2>
          <p className="mt-2 text-sm text-muted-foreground">Entry candle {replayTime(replay.entryTime)}{replay.outcomeTime ? " · Outcome candle " + replayTime(replay.outcomeTime) : ""}</p>
          <p className="mt-2 text-sm text-muted-foreground">Outcome starts with the next candle. P&amp;L uses the selected levels before fees and slippage.</p>
          {replay.notes && (
            <>
              <h3 className="mt-5 text-sm font-semibold">Setup notes</h3>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm">{replay.notes}</p>
            </>
          )}
        </section>
      </article>
    </main>
  )
}
