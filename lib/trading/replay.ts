import { ASSETS, quoteCurrencyOf, twelveDataSymbol } from "./assets"

export const REPLAY_TIMEFRAMES = [
  { seconds: 60, label: "1m" },
  { seconds: 300, label: "5m" },
  { seconds: 900, label: "15m" },
  { seconds: 3600, label: "1h" },
  { seconds: 14400, label: "4h" },
  { seconds: 86400, label: "1d" },
] as const

export const REPLAY_ASSETS = ASSETS.filter((asset) => twelveDataSymbol(asset))
export const isReplayId = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)

export interface ReplayCandle {
  time: number
  open: number
  high: number
  low: number
  close: number
}

export interface ReplaySetup {
  symbol: string
  timeframe: number
  entryTime: number
  direction: "buy" | "sell"
  entry: number
  stopLoss: number
  target: number
  lots: number
}

type ReplayOutcome = "target" | "stop" | "ambiguous" | "unresolved"

export interface ReplayResult {
  outcome: ReplayOutcome
  outcomeTime: number | null
  examplePnl: number | null
  currency: string
}

export interface SavedReplay extends ReplaySetup, ReplayResult {
  id: string
  notes: string
}

export const REPLAY_OUTCOME: Record<ReplayOutcome, string> = {
  target: "Target reached",
  stop: "Stop-loss reached",
  ambiguous: "Both levels touched in one candle",
  unresolved: "Neither level reached in available candles",
}

export function completedCandles(candles: ReplayCandle[], timeframe: number, now = Date.now()) {
  const available = new Map<number, ReplayCandle>()
  for (const bar of candles) {
    const prices = [bar.open, bar.high, bar.low, bar.close]
    if (
      Number.isSafeInteger(bar.time) && bar.time > 0 && (bar.time + timeframe) * 1000 <= now &&
      prices.every((price) => Number.isFinite(price) && price > 0) &&
      bar.low <= Math.min(bar.open, bar.close) && bar.high >= Math.max(bar.open, bar.close)
    ) {
      available.set(bar.time, bar)
    }
  }
  return Array.from(available.values()).sort((a, b) => a.time - b.time)
}

/** Compare levels against completed OHLC bars. A candle cannot tell us the order of its high and low. */
export function evaluateReplay(setup: ReplaySetup, candles: ReplayCandle[]): ReplayResult {
  const asset = REPLAY_ASSETS.find((item) => item.symbol === setup.symbol)
  if (!asset) throw new Error("Choose a supported instrument.")
  const entryBar = candles.find((bar) => bar.time === setup.entryTime)
  if (!entryBar) throw new Error("Choose an entry on an available, completed candle.")
  if (setup.entry < entryBar.low || setup.entry > entryBar.high) {
    throw new Error("Entry price must be within the selected candle's range.")
  }
  const buy = setup.direction === "buy"
  const ordered = buy
    ? setup.stopLoss < setup.entry && setup.entry < setup.target
    : setup.target < setup.entry && setup.entry < setup.stopLoss
  if (!ordered) {
    throw new Error(buy ? "For a buy, stop-loss < entry < target." : "For a sell, target < entry < stop-loss.")
  }

  const currency = quoteCurrencyOf(setup.symbol)
  for (const bar of candles) {
    if (bar.time <= setup.entryTime) continue
    const atStop = buy ? bar.low <= setup.stopLoss : bar.high >= setup.stopLoss
    const atTarget = buy ? bar.high >= setup.target : bar.low <= setup.target
    if (!atStop && !atTarget) continue
    if (atStop && atTarget) {
      return { outcome: "ambiguous", outcomeTime: bar.time, examplePnl: null, currency }
    }
    const exit = atTarget ? setup.target : setup.stopLoss
    const difference = buy ? exit - setup.entry : setup.entry - exit
    return {
      outcome: atTarget ? "target" : "stop",
      outcomeTime: bar.time,
      examplePnl: Number((difference * setup.lots * asset.contractSize).toFixed(2)),
      currency,
    }
  }
  return { outcome: "unresolved", outcomeTime: null, examplePnl: null, currency }
}

export function replayTime(time: number) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium", timeStyle: "short", timeZone: "UTC",
  }).format(time * 1000) + " UTC"
}

export function replayPnl(result: ReplayResult) {
  if (result.examplePnl === null) return "—"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: result.currency,
    currencyDisplay: "code",
    maximumFractionDigits: 2,
    signDisplay: "exceptZero",
  }).format(result.examplePnl)
}
