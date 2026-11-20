"use client"

import { useEffect, useRef } from "react"
import { useTheme } from "next-themes"
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts"
import type { ReplayCandle } from "@/lib/trading/replay"
import { readChartColors } from "../chart/theme"

interface ReplayChartProps {
  candles: ReplayCandle[]
  digits: number
  entryTime: number | null
  entry: number
  stopLoss: number
  target: number
  outcomeTime?: number | null
  onPick?: (time: number) => void
}

export function ReplayChart({ candles, digits, entryTime, entry, stopLoss, target, outcomeTime, onPick }: ReplayChartProps) {
  const container = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null)
  const { resolvedTheme } = useTheme()
  const interactive = Boolean(onPick)

  useEffect(() => {
    if (!container.current) return
    const c = readChartColors()
    const chart = createChart(container.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: c.axisText },
      grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
      rightPriceScale: { borderColor: c.border },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: c.border },
    })
    const series = chart.addSeries(CandlestickSeries, {
      upColor: c.up,
      downColor: c.down,
      wickUpColor: c.up,
      wickDownColor: c.down,
      borderVisible: false,
      lastValueVisible: false,
      priceLineVisible: false,
      priceFormat: { type: "price", precision: digits, minMove: 10 ** -digits },
    })
    series.setData(candles.map((bar) => ({ ...bar, time: bar.time as UTCTimestamp })))
    if (interactive && candles.length > 110) {
      chart.timeScale().setVisibleLogicalRange({ from: candles.length - 110, to: candles.length + 3 })
    } else {
      chart.timeScale().fitContent()
    }
    chartRef.current = chart
    seriesRef.current = series
    return () => {
      chartRef.current = null
      seriesRef.current = null
      chart.remove()
    }
  }, [candles, digits, interactive, resolvedTheme])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !onPick) return
    const pick = ({ time }: { time?: Time }) => {
      if (typeof time === "number") onPick(time)
    }
    chart.subscribeClick(pick)
    return () => chart.unsubscribeClick(pick)
  }, [candles, digits, onPick, resolvedTheme])

  useEffect(() => {
    const series = seriesRef.current
    if (!series) return
    const c = readChartColors()
    const levels = [
      { price: entry, color: c.primary, title: "Entry" },
      { price: stopLoss, color: c.loss, title: "Stop-loss" },
      { price: target, color: c.profit, title: "Target" },
    ].filter((level) => Number.isFinite(level.price) && level.price > 0)
    const lines = levels.map((level) => series.createPriceLine({
      ...level,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
    }))
    const markers: SeriesMarker<Time>[] = []
    if (entryTime !== null) markers.push({ time: entryTime as UTCTimestamp, position: "belowBar", shape: "circle", color: c.primary, text: "Entry" })
    if (outcomeTime) markers.push({ time: outcomeTime as UTCTimestamp, position: "aboveBar", shape: "circle", color: c.axisText, text: "Outcome" })
    const markerPlugin = createSeriesMarkers(series, markers)
    return () => {
      if (seriesRef.current !== series) return
      lines.forEach((line) => series.removePriceLine(line))
      markerPlugin.detach()
    }
  }, [candles, digits, entryTime, entry, stopLoss, target, outcomeTime, resolvedTheme])

  return <div ref={container} aria-label="Historical candlestick chart" className="h-[320px] w-full sm:h-[440px]" />
}
