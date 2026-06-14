import type { UTCTimestamp } from "lightweight-charts"

export interface Candle {
  time: UTCTimestamp
  open: number
  high: number
  low: number
  close: number
}

export interface LineData {
  time: UTCTimestamp
  value: number
}

/**
 * Calculate Simple Moving Average (SMA)
 */
export function calculateSMA(data: Candle[], period: number): LineData[] {
  const result: LineData[] = []
  if (data.length < period) return result

  let sum = 0
  for (let i = 0; i < data.length; i++) {
    sum += data[i].close
    if (i >= period) {
      sum -= data[i - period].close
    }
    if (i >= period - 1) {
      result.push({ time: data[i].time, value: sum / period })
    }
  }
  return result
}

/**
 * Calculate Exponential Moving Average (EMA)
 */
export function calculateEMA(data: Candle[], period: number): LineData[] {
  const result: LineData[] = []
  if (data.length < period) return result

  const k = 2 / (period + 1)
  
  // Calculate initial SMA for the first EMA value
  let sum = 0
  for (let i = 0; i < period; i++) {
    sum += data[i].close
  }
  let prevEMA = sum / period
  result.push({ time: data[period - 1].time, value: prevEMA })

  // Calculate subsequent EMA values
  for (let i = period; i < data.length; i++) {
    const ema = (data[i].close - prevEMA) * k + prevEMA
    result.push({ time: data[i].time, value: ema })
    prevEMA = ema
  }
  
  return result
}
