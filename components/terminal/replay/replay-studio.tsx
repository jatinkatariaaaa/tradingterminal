"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { ExternalLink, Link2 } from "lucide-react"
import { formatPrice, getAsset } from "@/lib/trading/assets"
import {
  completedCandles, evaluateReplay, REPLAY_ASSETS, REPLAY_OUTCOME, REPLAY_TIMEFRAMES, replayPnl, replayTime,
  type ReplayCandle, type ReplayResult, type SavedReplay,
} from "@/lib/trading/replay"
import { ReplayChart } from "./replay-chart"

const field = "mt-1 block h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground"
const secondary = "inline-flex min-h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-accent"

function ReplayLinks({ id }: { id: string }) {
  const [copy, setCopy] = useState("")
  const path = "/replay/" + id
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(new URL(path, location.origin).href)
      setCopy("Link copied")
    } catch {
      setCopy("Open the replay to copy its address.")
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <a href={path} target="_blank" rel="noreferrer" className={secondary}>
        <ExternalLink className="size-3.5" /> View replay
      </a>
      <button type="button" className={secondary} onClick={copyLink}><Link2 className="size-3.5" /> Copy link</button>
      <span role="status" className="text-xs text-muted-foreground">{copy}</span>
    </div>
  )
}

export function TradeReplayStudio({ accountId, initialSymbol, replays }: {
  accountId: string
  initialSymbol?: string
  replays: SavedReplay[]
}) {
  const router = useRouter()
  const [symbol, setSymbol] = useState(REPLAY_ASSETS.find((asset) => asset.symbol === initialSymbol)?.symbol ?? "XAUUSD")
  const [timeframe, setTimeframe] = useState<number>(900)
  const [candles, setCandles] = useState<ReplayCandle[]>([])
  const [loading, setLoading] = useState(true)
  const [chartError, setChartError] = useState("")
  const [entryTime, setEntryTime] = useState<number | null>(null)
  const [direction, setDirection] = useState<"buy" | "sell">("sell")
  const [entry, setEntry] = useState("")
  const [stopLoss, setStopLoss] = useState("")
  const [target, setTarget] = useState("")
  const [lots, setLots] = useState("1")
  const [notes, setNotes] = useState("")
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState("")
  const [savedId, setSavedId] = useState("")
  const request = useRef<{ payload: string; id: string } | null>(null)
  const asset = getAsset(symbol)

  function resetChartSelection() {
    setCandles([])
    setLoading(true)
    setChartError("")
    setEntryTime(null)
    setEntry("")
    setStopLoss("")
    setTarget("")
    setSaveError("")
  }

  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({ symbol, tf: String(timeframe) })
    fetch("/api/candles?" + params, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error()
        const payload = await response.json() as { candles: ReplayCandle[] }
        const history = completedCandles(payload.candles, timeframe)
        if (!controller.signal.aborted) {
          setCandles(history)
          if (!history.length) setChartError("No completed candles. Try another instrument or timeframe.")
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setChartError("Historical data could not be loaded. Try another timeframe.")
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [symbol, timeframe])

  const pick = useCallback((time: number) => {
    const bar = candles.find((item) => item.time === time)
    setEntryTime(bar?.time ?? null)
    setEntry(bar ? String(bar.close) : "")
    setSaveError("")
  }, [candles])
  const candleChoices = useMemo(() => [...candles].reverse().map((bar) => (
    <option key={bar.time} value={bar.time}>{replayTime(bar.time)}</option>
  )), [candles])

  const setup = { symbol, timeframe, entryTime: entryTime ?? 0, direction, entry: Number(entry), stopLoss: Number(stopLoss), target: Number(target), lots: Number(lots) }
  let preview: ReplayResult | null = null
  let validation = ""
  if (setup.entryTime && setup.entry > 0 && setup.stopLoss > 0 && setup.target > 0 && setup.lots >= 0.01 && setup.lots <= 100) {
    try {
      preview = evaluateReplay(setup, candles)
    } catch (error) {
      validation = (error as Error).message
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !preview) return
    setBusy(true)
    setSaveError("")
    const payload = { accountId, ...setup, notes: notes.trim() }
    const fingerprint = JSON.stringify(payload)
    if (request.current?.payload !== fingerprint) {
      request.current = { payload: fingerprint, id: crypto.randomUUID() }
    }
    try {
      const response = await fetch("/api/trade-replays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, id: request.current.id }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || "Could not save the replay.")
      setSavedId(result.id)
      router.refresh()
    } catch (error) {
      setSaveError((error as Error).message || "Could not save the replay.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex flex-wrap items-end gap-3 border-b border-border px-4 py-3">
            <label className="min-w-36 flex-1 text-xs font-medium text-muted-foreground">
              Instrument
              <select className={field} value={symbol} disabled={busy} onChange={(event) => {
                resetChartSelection()
                setSymbol(event.target.value)
              }}>
                {REPLAY_ASSETS.map((instrument) => <option key={instrument.symbol} value={instrument.symbol}>{instrument.symbol} · {instrument.label}</option>)}
              </select>
            </label>
            <label className="w-28 text-xs font-medium text-muted-foreground">
              Timeframe
              <select className={field} value={timeframe} disabled={busy} onChange={(event) => {
                resetChartSelection()
                setTimeframe(Number(event.target.value))
              }}>
                {REPLAY_TIMEFRAMES.map((tf) => <option key={tf.seconds} value={tf.seconds}>{tf.label}</option>)}
              </select>
            </label>
          </div>
          {candles.length > 0 ? (
            <ReplayChart candles={candles} digits={asset.digits} entryTime={entryTime} entry={setup.entry}
              stopLoss={setup.stopLoss} target={setup.target} outcomeTime={preview?.outcomeTime} onPick={pick} />
          ) : (
            <div className="grid h-[320px] place-items-center px-5 text-center text-sm text-muted-foreground sm:h-[440px]" role="status">
              {loading ? "Loading historical candles…" : chartError}
            </div>
          )}
        </section>
        <form onSubmit={save} className="space-y-4 rounded-2xl border border-border bg-card p-4">
          <h2 className="font-semibold">Replay setup</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">Click a candle to set its close as the starting entry, or select its time below.</p>
          <label className="block text-xs font-medium text-muted-foreground">
            Entry candle (UTC)
            <select className={field} disabled={!candles.length || busy} value={entryTime ?? ""} onChange={(event) => pick(Number(event.target.value))}>
              <option value="">Select a completed candle</option>
              {candleChoices}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-medium text-muted-foreground">
              Direction
              <select className={field} value={direction} onChange={(event) => setDirection(event.target.value === "buy" ? "buy" : "sell")}>
                <option value="sell">Sell</option>
                <option value="buy">Buy</option>
              </select>
            </label>
            <label className="text-xs font-medium text-muted-foreground">
              Size (lots)
              <input className={field} type="number" min="0.01" max="100" step="0.01" value={lots} onChange={(event) => setLots(event.target.value)} required />
            </label>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {([
              ["Entry price", entry, setEntry],
              ["Stop-loss", stopLoss, setStopLoss],
              ["Target", target, setTarget],
            ] as const).map(([label, value, setValue]) => (
              <label key={label} className="text-xs font-medium text-muted-foreground">
                {label}
                <input className={field + " px-2 font-mono"} type="number" min="0" max="100000000" step="any" value={value} onChange={(event) => setValue(event.target.value)} required />
              </label>
            ))}
          </div>
          <label className="block text-xs font-medium text-muted-foreground">
            Setup notes
            <textarea className={field + " h-auto min-h-16 py-2"} maxLength={500} rows={2} placeholder="Why did you choose this setup?" value={notes} onChange={(event) => setNotes(event.target.value)} />
          </label>
          {preview && (
            <div className="space-y-1 rounded-xl bg-secondary p-3 text-sm" role="status">
              <div className="flex justify-between gap-2 font-medium"><span>Hypothetical P&amp;L</span><span className="font-mono">{replayPnl(preview)}</span></div>
              <p className="text-xs text-muted-foreground">{REPLAY_OUTCOME[preview.outcome]}</p>
            </div>
          )}
          {(validation || saveError) && <p role="alert" className="text-xs text-loss">{saveError || validation}</p>}
          <p className="text-xs leading-relaxed text-muted-foreground">Saving creates an unlisted link. Anyone with the link can see the setup and notes.</p>
          <button disabled={!preview || Boolean(validation) || busy} className="min-h-10 w-full rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">
            {busy ? "Saving…" : "Create Trade Replay"}
          </button>
          {savedId && <div className="space-y-2 border-t border-border pt-3"><p className="text-sm font-medium" role="status">Replay saved</p><ReplayLinks key={savedId} id={savedId} /></div>}
        </form>
      </div>
      <section className="mt-6 space-y-3">
        <h2 className="text-lg font-semibold">Saved replays</h2>
        {replays.length === 0 ? <p className="text-sm text-muted-foreground">No replays for this account yet.</p> : (
          <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
            {replays.map((replay) => {
              const digits = getAsset(replay.symbol).digits
              return (
                <li key={replay.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold">{replay.symbol} · {replay.direction === "buy" ? "Buy" : "Sell"} · {replayTime(replay.entryTime)}</p>
                    <p className="text-xs text-muted-foreground">
                      Entry {formatPrice(replay.entry, digits)} · Stop {formatPrice(replay.stopLoss, digits)} · Target {formatPrice(replay.target, digits)} · Hypothetical P&amp;L {replayPnl(replay)}
                    </p>
                  </div>
                  <ReplayLinks id={replay.id} />
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </>
  )
}
