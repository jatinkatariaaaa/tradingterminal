"use client"

import { useEffect, useRef, useState } from "react"
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts"
import { cn } from "@/lib/utils"
import { formatPrice, getAsset } from "@/lib/trading/assets"
import { categoryOf } from "@/lib/trading/category"
import { isMarketOpen } from "@/lib/trading/market-hours"
import { useIsMobile } from "@/hooks/use-mobile"
import { useTheme } from "next-themes"
import { useTrading } from "./trading-provider"
import { ChartOverlay } from "./chart-overlay"
import type { ChartApi } from "./chart-api"

// Selectable chart timeframes (seconds per candle).
const TIMEFRAMES = [
  { label: "5s", seconds: 5 },
  { label: "15s", seconds: 15 },
  { label: "1m", seconds: 60 },
  { label: "5m", seconds: 300 },
  { label: "15m", seconds: 900 },
  { label: "1h", seconds: 3600 },
  { label: "4h", seconds: 14_400 },
  { label: "1D", seconds: 86_400 },
  { label: "1W", seconds: 604_800 },
] as const

// Seed a deep history so traders can scroll well back in time on every
// timeframe (e.g. 600 bars = 10h on 1m, ~2 days on 5m, 25 days on 1h).
const SEED_CANDLES = 600
// How many of the most-recent bars to frame on load; the rest stay scrollable.
const VISIBLE_CANDLES = 140

import { calculateSMA, calculateEMA } from "@/lib/trading/indicators"

interface Candle {
  time: UTCTimestamp
  open: number
  high: number
  low: number
  close: number
}

const INDICATORS = [
  { id: "sma-20", label: "SMA 20", calc: (data: Candle[]) => calculateSMA(data, 20), color: "#2962FF" },
  { id: "sma-50", label: "SMA 50", calc: (data: Candle[]) => calculateSMA(data, 50), color: "#FF6D00" },
  { id: "ema-200", label: "EMA 200", calc: (data: Candle[]) => calculateEMA(data, 200), color: "#D50000" },
]

export function ChartPanel() {
  const { activeSymbol, marketPrice, binanceConnected } = useTrading()
  const isMobile = useIsMobile()
  const { resolvedTheme } = useTheme()
  const asset = getAsset(activeSymbol)

  // Default to 1h timeframe (index 5) so the chart always has deep history on mount,
  // preventing blank/empty charts on weekends when sub-minute ticks aren't streaming.
  const [timeframe, setTimeframe] = useState<number>(TIMEFRAMES[5].seconds)
  const [activeIndicators, setActiveIndicators] = useState<string[]>([])

  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null)
  const chartApiRef = useRef<ChartApi | null>(null)
  const indicatorSeriesRef = useRef(new Map<string, ISeriesApi<"Line">>())
  const historyRef = useRef<Candle[]>([])

  // Candle bookkeeping (kept in refs so the tick effect stays cheap).
  const candleRef = useRef<Candle | null>(null)
  // Seeding is keyed by symbol + timeframe so a switch re-seeds history.
  const seededKeyRef = useRef<string | null>(null)
  const periodRef = useRef(timeframe)
  periodRef.current = timeframe

  // ---- Create the chart once. -------------------------------------------
  useEffect(() => {
    if (!containerRef.current) return
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#8b93a6",
        fontFamily: "var(--font-mono), monospace",
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.04)" },
        horzLines: { color: "rgba(255,255,255,0.04)" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.08)", scaleMargins: { top: 0.12, bottom: 0.12 } },
      timeScale: { borderColor: "rgba(255,255,255,0.08)", timeVisible: true, secondsVisible: false },
      autoSize: true,
    })
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#26b96a",
      downColor: "#e0533d",
      borderUpColor: "#26b96a",
      borderDownColor: "#e0533d",
      wickUpColor: "#26b96a",
      wickDownColor: "#e0533d",
    })
    chartRef.current = chart
    seriesRef.current = series

    // Expose the price<->pixel bridge for the overlay.
    chartApiRef.current = {
      priceToY: (price) => {
        const c = seriesRef.current?.priceToCoordinate(price)
        return c == null ? null : c
      },
      yToPrice: (y) => {
        const p = seriesRef.current?.coordinateToPrice(y)
        return p == null ? null : (p as number)
      },
      paneHeight: () => containerRef.current?.clientHeight ?? 0,
    }

    return () => {
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [])

  // ---- Update chart colors when theme changes. ---------------------------
  useEffect(() => {
    if (!chartRef.current) return
    const isDark = resolvedTheme === "dark"
    chartRef.current.applyOptions({
      layout: {
        textColor: isDark ? "#8b93a6" : "#5d6b82",
      },
      grid: {
        vertLines: { color: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.06)" },
        horzLines: { color: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.06)" },
      },
      rightPriceScale: { borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.1)" },
      timeScale: { borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.1)" },
    })
  }, [resolvedTheme])

  // ---- Match the price-axis precision to the asset (so every pip shows). -
  useEffect(() => {
    seriesRef.current?.applyOptions({
      priceFormat: {
        type: "price",
        precision: asset.digits,
        minMove: 1 / 10 ** asset.digits,
      },
    })
  }, [asset.digits])

  // ---- Load history when the symbol or timeframe changes. ---------------
  // Fetches REAL OHLC candles from /api/candles (Yahoo) so the chart matches
  // the actual market; falls back to the local simulator if the fetch is empty.
  useEffect(() => {
    if (!seriesRef.current || marketPrice <= 0) return
    const key = `${activeSymbol}:${timeframe}`
    if (seededKeyRef.current === key) return
    seededKeyRef.current = key

    let cancelled = false

    // Clear previous data immediately so we don't mix assets, and force auto-scale.
    seriesRef.current.setData([])
    chartRef.current?.priceScale("right").applyOptions({ autoScale: true })
    candleRef.current = null
    historyRef.current = []

    const applyHistory = (history: Candle[]) => {
      if (cancelled || !seriesRef.current || seededKeyRef.current !== key) return
      seriesRef.current.setData(history)
      historyRef.current = [...history]
      
      if (history.length > 0) {
        candleRef.current = { ...history[history.length - 1] }
      }
      
      // Update indicators
      const chart = chartRef.current
      const map = indicatorSeriesRef.current
      if (chart) {
        for (const id of activeIndicators) {
          const def = INDICATORS.find(i => i.id === id)
          const series = map.get(id)
          if (def && series) {
            series.setData(history.length > 0 ? def.calc(history) : [])
          }
        }
      }

      // Frame the most-recent VISIBLE_CANDLES bars (with a little room on the
      // right), leaving the deeper history pannable to the left.
      chartRef.current?.timeScale().setVisibleLogicalRange({
        from: Math.max(0, history.length - VISIBLE_CANDLES),
        to: history.length + 2,
      })
    }

    const load = async () => {
      try {
        const res = await fetch(
          `/api/candles?symbol=${encodeURIComponent(activeSymbol)}&tf=${timeframe}`,
        )
        if (!res.ok) throw new Error("Fetch failed")
        const json = (await res.json()) as {
          candles?: { time: number; open: number; high: number; low: number; close: number }[]
        }
        const raw = json.candles ?? []
        
        if (raw.length === 0) {
          throw new Error("No candles returned")
        }
        
        const real: Candle[] = raw.map((c) => ({
          time: c.time as UTCTimestamp,
          open: Number(c.open.toFixed(asset.digits)),
          high: Number(c.high.toFixed(asset.digits)),
          low: Number(c.low.toFixed(asset.digits)),
          close: Number(c.close.toFixed(asset.digits)),
        }))
        applyHistory(real)
      } catch {
        // Network error or empty history — seed a single starting candle
        // at the current market price so the chart axis focuses correctly.
        const now = Math.floor(Date.now() / 1000)
        const bucket = (now - (now % timeframe)) as UTCTimestamp
        const seed: Candle = {
          time: bucket,
          open: marketPrice,
          high: marketPrice,
          low: marketPrice,
          close: marketPrice,
        }
        applyHistory([seed])
      }
    }
    load()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSymbol, timeframe, marketPrice > 0, activeIndicators])

  // ---- Manage Active Indicators ------------------------------------------
  useEffect(() => {
    if (!chartRef.current) return
    const chart = chartRef.current
    const map = indicatorSeriesRef.current
    
    // Remove inactive indicators
    for (const [id, series] of map.entries()) {
      if (!activeIndicators.includes(id)) {
        chart.removeSeries(series)
        map.delete(id)
      }
    }
    
    // Add new indicators
    for (const id of activeIndicators) {
      if (!map.has(id)) {
        const def = INDICATORS.find(i => i.id === id)
        if (!def) continue
        const series = chart.addLineSeries({
          color: def.color,
          lineWidth: 2,
          crosshairMarkerVisible: false,
          priceLineVisible: false,
        })
        map.set(id, series)
        
        // Seed with current history if available
        if (historyRef.current.length > 0) {
          series.setData(def.calc(historyRef.current))
        }
      }
    }
  }, [activeIndicators])

  // ---- Live tick: update / roll the current candle & indicators. --------
  useEffect(() => {
    const series = seriesRef.current
    if (!series || seededKeyRef.current !== `${activeSymbol}:${timeframe}`) return
    
    // Safety check requested by user to prevent NaN/null spikes
    const price = Number.parseFloat(marketPrice as any)
    if (!Number.isFinite(price) || price <= 0) return

    // STRICT WEEKEND CHECK: Completely freeze the chart if the market is closed.
    // This stops dummy heartbeat doji candles from forming on lower timeframes.
    if (!isMarketOpen(categoryOf(activeSymbol))) return

    const period = periodRef.current
    const now = Math.floor(Date.now() / 1000)
    const bucket = (now - (now % period)) as UTCTimestamp
    const cur = candleRef.current

    if (!cur || bucket > cur.time) {
      const next: Candle = {
        time: bucket,
        open: cur ? cur.close : price,
        high: price,
        low: price,
        close: price,
      }
      candleRef.current = next
      series.update(next)
      historyRef.current.push(next)
    } else if (bucket === cur.time) {
      cur.close = price
      cur.high = Math.max(cur.high, price)
      cur.low = Math.min(cur.low, price)
      series.update(cur)
      if (historyRef.current.length > 0) {
        historyRef.current[historyRef.current.length - 1] = { ...cur }
      }
    }

    // Update active indicators for live tick
    for (const id of activeIndicators) {
      const def = INDICATORS.find(i => i.id === id)
      const lineSeries = indicatorSeriesRef.current.get(id)
      if (def && lineSeries && historyRef.current.length > 0) {
        const data = def.calc(historyRef.current)
        if (data.length > 0) {
          lineSeries.update(data[data.length - 1])
        }
      }
    }
  }, [marketPrice, activeSymbol, timeframe, activeIndicators])

  const feedLabel =
    asset.feed === "binance" ? "Binance WS" : asset.feed === "massive" ? "Massive + Sim" : "Internal Sim"
  const feedLive = asset.feed === "binance" ? binanceConnected : true
  const feedTitle =
    asset.feed === "binance"
      ? "Real-time prices from the public Binance combined ticker stream"
      : asset.feed === "massive"
        ? "Real anchor price from massive.com, kept live by the internal simulator"
        : "Internal 500ms math simulator"

  return (
    <section className="flex h-full min-h-0 flex-col bg-background">
      {/* Symbol header — hidden on mobile (shown in compact top bar instead) */}
      {!isMobile && (
        <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-2.5">
          <div className="flex items-baseline gap-3">
            <h2 className="text-sm font-semibold">{asset.symbol}</h2>
            <span className="text-xs text-muted-foreground">{asset.label}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-base font-semibold tabular-nums">
              {formatPrice(marketPrice, asset.digits)}
            </span>
            <span
              className="flex items-center gap-1.5 rounded-md bg-secondary px-2 py-1 text-[10px] font-medium text-secondary-foreground"
              title={feedTitle}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: feedLive ? "var(--profit)" : "var(--muted-foreground)" }}
              />
              {feedLabel}
            </span>
          </div>
        </div>
      )}

      {/* Timeframe switcher & Indicators — scrollable on mobile */}
      <div className={cn(
        "flex items-center gap-1 border-b border-border px-2 py-1",
        isMobile && "overflow-x-auto scrollbar-none"
      )}>
        <div className="flex items-center gap-1 pr-2 border-r border-border/50">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.seconds}
              type="button"
              onClick={() => setTimeframe(tf.seconds)}
              aria-pressed={timeframe === tf.seconds}
              className={cn(
                "shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px] font-medium tabular-nums transition-colors",
                timeframe === tf.seconds
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              {tf.label}
            </button>
          ))}
        </div>
        
        <div className="flex items-center gap-1 pl-1">
          {INDICATORS.map((ind) => {
            const isActive = activeIndicators.includes(ind.id)
            return (
              <button
                key={ind.id}
                type="button"
                onClick={() => {
                  setActiveIndicators(prev => 
                    isActive ? prev.filter(id => id !== ind.id) : [...prev, ind.id]
                  )
                }}
                className={cn(
                  "flex items-center gap-1.5 shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px] font-medium tabular-nums transition-colors",
                  isActive
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                <div 
                  className="w-1.5 h-1.5 rounded-full" 
                  style={{ backgroundColor: isActive ? ind.color : "transparent", border: `1px solid ${ind.color}` }} 
                />
                {ind.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Chart + interaction overlay */}
      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="absolute inset-0 h-full w-full" />
        <ChartOverlay chartApiRef={chartApiRef} />
      </div>
    </section>
  )
}
