import type { UTCTimestamp } from "lightweight-charts"

export interface OhlcBar {
  time: UTCTimestamp
  open: number
  high: number
  low: number
  close: number
}

export interface LinePoint {
  time: UTCTimestamp
  value: number
}

export type IndicatorId = "sma20" | "ema50" | "bb20" | "rsi14" | "macd"

export const INDICATOR_LABELS: Record<IndicatorId, string> = {
  sma20: "SMA 20",
  ema50: "EMA 50",
  bb20: "Bollinger (20, 2)",
  rsi14: "RSI 14",
  macd: "MACD (12, 26, 9)",
}

/** Which pane an indicator renders in: 0 = price pane, 1+ = sub-pane. */
export const INDICATOR_PANE: Record<IndicatorId, number> = {
  sma20: 0,
  ema50: 0,
  bb20: 0,
  rsi14: 1,
  macd: 2,
}

export function sma(bars: OhlcBar[], period: number): LinePoint[] {
  const out: LinePoint[] = []
  let sum = 0
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].close
    if (i >= period) sum -= bars[i - period].close
    if (i >= period - 1) out.push({ time: bars[i].time, value: sum / period })
  }
  return out
}

export function ema(bars: OhlcBar[], period: number): LinePoint[] {
  if (bars.length < period) return []
  const k = 2 / (period + 1)
  const out: LinePoint[] = []
  // Seed with SMA of the first `period` closes.
  let prev = bars.slice(0, period).reduce((s, b) => s + b.close, 0) / period
  out.push({ time: bars[period - 1].time, value: prev })
  for (let i = period; i < bars.length; i++) {
    prev = bars[i].close * k + prev * (1 - k)
    out.push({ time: bars[i].time, value: prev })
  }
  return out
}

export function bollinger(
  bars: OhlcBar[],
  period = 20,
  mult = 2,
): { middle: LinePoint[]; upper: LinePoint[]; lower: LinePoint[] } {
  const middle = sma(bars, period)
  const upper: LinePoint[] = []
  const lower: LinePoint[] = []
  for (let i = period - 1; i < bars.length; i++) {
    const mean = middle[i - (period - 1)].value
    let variance = 0
    for (let j = i - period + 1; j <= i; j++) {
      const d = bars[j].close - mean
      variance += d * d
    }
    const sd = Math.sqrt(variance / period)
    upper.push({ time: bars[i].time, value: mean + mult * sd })
    lower.push({ time: bars[i].time, value: mean - mult * sd })
  }
  return { middle, upper, lower }
}

export function rsi(bars: OhlcBar[], period = 14): LinePoint[] {
  if (bars.length <= period) return []
  const out: LinePoint[] = []
  let gain = 0
  let loss = 0
  for (let i = 1; i <= period; i++) {
    const d = bars[i].close - bars[i - 1].close
    if (d >= 0) gain += d
    else loss -= d
  }
  let avgGain = gain / period
  let avgLoss = loss / period
  const push = (i: number) => {
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss
    out.push({ time: bars[i].time, value: avgLoss === 0 ? 100 : 100 - 100 / (1 + rs) })
  }
  push(period)
  for (let i = period + 1; i < bars.length; i++) {
    const d = bars[i].close - bars[i - 1].close
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period
    push(i)
  }
  return out
}

export function macd(
  bars: OhlcBar[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): { macd: LinePoint[]; signal: LinePoint[]; histogram: LinePoint[] } {
  const emaFast = ema(bars, fast)
  const emaSlow = ema(bars, slow)
  if (emaSlow.length === 0) return { macd: [], signal: [], histogram: [] }

  // Align by time: emaSlow starts later.
  const offset = emaFast.length - emaSlow.length
  const macdLine: LinePoint[] = emaSlow.map((p, i) => ({
    time: p.time,
    value: emaFast[i + offset].value - p.value,
  }))

  // Signal = EMA of the MACD line.
  const signal: LinePoint[] = []
  if (macdLine.length >= signalPeriod) {
    const k = 2 / (signalPeriod + 1)
    let prev = macdLine.slice(0, signalPeriod).reduce((s, p) => s + p.value, 0) / signalPeriod
    signal.push({ time: macdLine[signalPeriod - 1].time, value: prev })
    for (let i = signalPeriod; i < macdLine.length; i++) {
      prev = macdLine[i].value * k + prev * (1 - k)
      signal.push({ time: macdLine[i].time, value: prev })
    }
  }

  const sigOffset = macdLine.length - signal.length
  const histogram: LinePoint[] = signal.map((p, i) => ({
    time: p.time,
    value: macdLine[i + sigOffset].value - p.value,
  }))

  return { macd: macdLine, signal, histogram }
}
