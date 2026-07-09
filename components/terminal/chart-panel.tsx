"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type UTCTimestamp,
} from "lightweight-charts"
import { cn } from "@/lib/utils"
import { formatPrice, getAsset } from "@/lib/trading/assets"
import { categoryOf } from "@/lib/trading/category"
import { isMarketOpen, isMarketOpenAt } from "@/lib/trading/market-hours"
import { useIsMobile } from "@/hooks/use-mobile"
import { useTheme } from "next-themes"
import { useTrading } from "./trading-provider"
import { ChartOverlay } from "./chart-overlay"
import type { ChartApi } from "./chart-api"
import { readChartColors } from "./chart/theme"
import { IndicatorManager } from "./chart/indicator-manager"
import type { IndicatorId, OhlcBar } from "./chart/indicators"
import { ChartToolbar, type ChartStyle } from "./chart/chart-toolbar"
import { QuoteButton } from "./watchlist/quote-button"
import { bidAsk, spreadOf } from "@/lib/trading/assets"
import { useQuickTrade } from "./chart/use-quick-trade"

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

// How many of the most-recent bars to frame on load; the rest stay scrollable.
const VISIBLE_CANDLES = 140
// Bars of synthetic history to generate when the real-candle fetch is empty.
const SEED_CANDLES = 600

type Candle = OhlcBar

type MainSeries = ISeriesApi<"Candlestick"> | ISeriesApi<"Line"> | ISeriesApi<"Area">

const INDICATORS_STORAGE_KEY = "tt-chart-indicators"
const STYLE_STORAGE_KEY = "tt-chart-style"

function loadStoredIndicators(): IndicatorId[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(INDICATORS_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as IndicatorId[]) : []
  } catch {
    return []
  }
}

function loadStoredStyle(): ChartStyle {
  if (typeof window === "undefined") return "candles"
  const raw = window.localStorage.getItem(STYLE_STORAGE_KEY)
  return raw === "line" || raw === "area" ? raw : "candles"
}

export function ChartPanel() {
  const { activeSymbol, marketPrice, binanceConnected } = useTrading()
  const isMobile = useIsMobile()
  const { resolvedTheme } = useTheme()
  const asset = getAsset(activeSymbol)
  const { fire, isSubmitting } = useQuickTrade()

  // Default to 1h timeframe (index 5) so the chart always has deep history on mount,
  // preventing blank/empty charts on weekends when sub-minute ticks aren't streaming.
  const [timeframe, setTimeframe] = useState<number>(TIMEFRAMES[5].seconds)
  // Start with SSR-safe defaults; hydrate persisted prefs after mount to avoid
  // a hydration mismatch (server can't read localStorage).
  const [chartStyle, setChartStyle] = useState<ChartStyle>("candles")
  const [indicators, setIndicators] = useState<IndicatorId[]>([])
  const [prefsLoaded, setPrefsLoaded] = useState(false)
  const [hoverBar, setHoverBar] = useState<Candle | null>(null)

  useEffect(() => {
    setChartStyle(loadStoredStyle())
    setIndicators(loadStoredIndicators())
    setPrefsLoaded(true)
  }, [])

  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<MainSeries | null>(null)
  const chartApiRef = useRef<ChartApi | null>(null)
  const indicatorMgrRef = useRef<IndicatorManager | null>(null)

  // Candle bookkeeping (kept in refs so the tick effect stays cheap).
  const candleRef = useRef<Candle | null>(null)
  /** Full bar history for the active symbol+timeframe (drives indicators). */
  const barsRef = useRef<Candle[]>([])
  // Seeding is keyed by symbol + timeframe so a switch re-seeds history.
  const seededKeyRef = useRef<string | null>(null)
  const periodRef = useRef(timeframe)
  periodRef.current = timeframe
  const chartStyleRef = useRef(chartStyle)
  chartStyleRef.current = chartStyle

  /** (Re)create the main price series in the requested style with current data. */
  const mountMainSeries = useCallback((chart: IChartApi, style: ChartStyle): MainSeries => {
    const c = readChartColors()
    let series: MainSeries
    if (style === "line") {
      series = chart.addSeries(LineSeries, { color: c.up, lineWidth: 2 }, 0)
      series.setData(barsRef.current.map((b) => ({ time: b.time, value: b.close })))
    } else if (style === "area") {
      series = chart.addSeries(
        AreaSeries,
        { lineColor: c.up, topColor: `color-mix(in srgb, ${c.up} 25%, transparent)`, bottomColor: "transparent", lineWidth: 2 },
        0,
      )
      series.setData(barsRef.current.map((b) => ({ time: b.time, value: b.close })))
    } else {
      series = chart.addSeries(
        CandlestickSeries,
        {
          upColor: c.up,
          downColor: c.down,
          borderUpColor: c.up,
          borderDownColor: c.down,
          wickUpColor: c.up,
          wickDownColor: c.down,
        },
        0,
      )
      series.setData(barsRef.current)
    }
    return series
  }, [])

  // ---- Create the chart once. -------------------------------------------
  useEffect(() => {
    if (!containerRef.current) return
    const c = readChartColors()
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: c.axisText,
        fontFamily: "var(--font-mono), monospace",
        panes: { separatorColor: c.border, separatorHoverColor: c.crosshair },
      },
      grid: {
        vertLines: { color: c.grid },
        horzLines: { color: c.grid },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: c.border, scaleMargins: { top: 0.12, bottom: 0.12 } },
      timeScale: { borderColor: c.border, timeVisible: true, secondsVisible: false },
      autoSize: true,
    })
    const series = mountMainSeries(chart, chartStyleRef.current)
    chartRef.current = chart
    seriesRef.current = series
    indicatorMgrRef.current = new IndicatorManager(chart)

    // OHLC legend: track the crosshair-hovered bar.
    const onCrosshair = (param: MouseEventParams) => {
      if (!param.time || !seriesRef.current) {
        setHoverBar(null)
        return
      }
      const bar = param.seriesData.get(seriesRef.current) as Candle | { value: number } | undefined
      if (bar && "open" in bar) setHoverBar(bar as Candle)
      else setHoverBar(null)
    }
    chart.subscribeCrosshairMove(onCrosshair)

    // Expose the price<->pixel bridge for the overlay.
    chartApiRef.current = {
      priceToY: (price) => {
        const coord = seriesRef.current?.priceToCoordinate(price)
        return coord == null ? null : coord
      },
      yToPrice: (y) => {
        const p = seriesRef.current?.coordinateToPrice(y)
        return p == null ? null : (p as number)
      },
      paneHeight: () => {
        // With sub-panes active, the overlay must map against the price pane only.
        const pane = chartRef.current?.panes()[0]
        return pane ? pane.getHeight() : (containerRef.current?.clientHeight ?? 0)
      },
    }

    return () => {
      chart.unsubscribeCrosshairMove(onCrosshair)
      indicatorMgrRef.current?.destroy()
      indicatorMgrRef.current = null
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [mountMainSeries])

  // ---- Swap the main series when the chart style changes. ----------------
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !seriesRef.current) return
    if (prefsLoaded && typeof window !== "undefined") window.localStorage.setItem(STYLE_STORAGE_KEY, chartStyle)
    chart.removeSeries(seriesRef.current)
    seriesRef.current = mountMainSeries(chart, chartStyle)
    // Re-apply precision after remount.
    seriesRef.current.applyOptions({
      priceFormat: { type: "price", precision: asset.digits, minMove: 1 / 10 ** asset.digits },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartStyle, mountMainSeries])

  // ---- Sync indicators with the manager. ----------------------------------
  useEffect(() => {
    if (prefsLoaded && typeof window !== "undefined") {
      window.localStorage.setItem(INDICATORS_STORAGE_KEY, JSON.stringify(indicators))
    }
    indicatorMgrRef.current?.sync(indicators, barsRef.current)
  }, [indicators, prefsLoaded])

  const toggleIndicator = useCallback((id: IndicatorId) => {
    setIndicators((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }, [])

  // ---- Update chart colors when theme changes (all from CSS tokens). -----
  useEffect(() => {
    if (!chartRef.current) return
    // Wait a frame so the .dark class change has been applied to <html>.
    const raf = requestAnimationFrame(() => {
      if (!chartRef.current) return
      const c = readChartColors()
      chartRef.current.applyOptions({
        layout: { textColor: c.axisText, panes: { separatorColor: c.border, separatorHoverColor: c.crosshair } },
        grid: {
          vertLines: { color: c.grid },
          horzLines: { color: c.grid },
        },
        rightPriceScale: { borderColor: c.border },
        timeScale: { borderColor: c.border },
      })
      const s = seriesRef.current
      if (s) {
        if (s.seriesType() === "Candlestick") {
          ;(s as ISeriesApi<"Candlestick">).applyOptions({
            upColor: c.up,
            downColor: c.down,
            borderUpColor: c.up,
            borderDownColor: c.down,
            wickUpColor: c.up,
            wickDownColor: c.down,
          })
        } else if (s.seriesType() === "Line") {
          ;(s as ISeriesApi<"Line">).applyOptions({ color: c.up })
        } else if (s.seriesType() === "Area") {
          ;(s as ISeriesApi<"Area">).applyOptions({
            lineColor: c.up,
            topColor: `color-mix(in srgb, ${c.up} 25%, transparent)`,
          })
        }
      }
      indicatorMgrRef.current?.refreshColors()
      indicatorMgrRef.current?.update(barsRef.current)
    })
    return () => cancelAnimationFrame(raf)
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

  /** Push a bar array into the main series in whatever style is mounted. */
  const setSeriesData = useCallback((bars: Candle[]) => {
    const s = seriesRef.current
    if (!s) return
    if (s.seriesType() === "Candlestick") {
      ;(s as ISeriesApi<"Candlestick">).setData(bars)
    } else {
      ;(s as ISeriesApi<"Line"> | ISeriesApi<"Area">).setData(
        bars.map((b) => ({ time: b.time, value: b.close })),
      )
    }
  }, [])

  /** Update the latest bar in the main series in whatever style is mounted. */
  const updateSeriesBar = useCallback((bar: Candle) => {
    const s = seriesRef.current
    if (!s) return
    if (s.seriesType() === "Candlestick") {
      ;(s as ISeriesApi<"Candlestick">).update(bar)
    } else {
      ;(s as ISeriesApi<"Line"> | ISeriesApi<"Area">).update({ time: bar.time, value: bar.close })
    }
  }, [])

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
    setSeriesData([])
    chartRef.current?.priceScale("right").applyOptions({ autoScale: true })
    candleRef.current = null
    barsRef.current = []

    const applyHistory = (history: Candle[]) => {
      if (cancelled || !seriesRef.current || seededKeyRef.current !== key) return
      barsRef.current = history
      setSeriesData(history)
      indicatorMgrRef.current?.update(history)
      if (history.length > 0) {
        candleRef.current = { ...history[history.length - 1] }
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
        // Network error or empty history — synthesize a random-walk history
        // that ends exactly at the current market price so the chart is never
        // blank and the live tick continues seamlessly from the last bar.
        // Weekend buckets are skipped for closed markets so no dummy candles
        // form on Saturday/Sunday (matches how TradingView shows a gap).
        const category = categoryOf(activeSymbol)
        const now = Math.floor(Date.now() / 1000)
        const digits = asset.digits
        const round = (v: number) => Number(v.toFixed(digits))
        // Volatility per bar scales gently with the timeframe.
        const vol = marketPrice * 0.0004 * Math.min(6, Math.max(1, Math.sqrt(timeframe / 60)))
        const seeded: Candle[] = []
        let close = marketPrice
        let bucket = now - (now % timeframe)
        let guard = SEED_CANDLES * 4 // hard cap on scanned buckets
        // Walk backwards from the current price so the final candle matches it,
        // only emitting bars for buckets when the market was actually open.
        while (seeded.length < SEED_CANDLES && guard-- > 0) {
          if (isMarketOpenAt(category, bucket)) {
            const drift = (Math.random() - 0.5) * vol * 2
            const open = close - drift
            const high = Math.max(open, close) + Math.random() * vol * 0.6
            const low = Math.min(open, close) - Math.random() * vol * 0.6
            seeded.unshift({
              time: bucket as UTCTimestamp,
              open: round(open),
              high: round(high),
              low: round(low),
              close: round(close),
            })
            close = open
          }
          bucket -= timeframe
        }
        applyHistory(seeded)
      }
    }
    load()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSymbol, timeframe, marketPrice > 0])

  // ---- Live tick: update / roll the current candle. ---------------------
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
      barsRef.current.push(next)
      updateSeriesBar(next)
      // New bar completed — refresh indicators (bounded: <=600 bars).
      indicatorMgrRef.current?.update(barsRef.current)
    } else if (bucket === cur.time) {
      cur.close = price
      cur.high = Math.max(cur.high, price)
      cur.low = Math.min(cur.low, price)
      const last = barsRef.current[barsRef.current.length - 1]
      if (last && last.time === cur.time) {
        last.close = cur.close
        last.high = cur.high
        last.low = cur.low
      }
      updateSeriesBar(cur)
    }
  }, [marketPrice, activeSymbol, timeframe, updateSeriesBar])

  const feedLabel =
    asset.feed === "binance" ? "Binance WS" : asset.feed === "massive" ? "Massive + Sim" : "Internal Sim"
  const feedLive = asset.feed === "binance" ? binanceConnected : true
  const feedTitle =
    asset.feed === "binance"
      ? "Real-time prices from the public Binance combined ticker stream"
      : asset.feed === "massive"
        ? "Real anchor price from massive.com, kept live by the internal simulator"
        : "Internal 500ms math simulator"

  // On-chart quote buttons (bid/ask from the live mid).
  const spread = spreadOf(asset, marketPrice)
  const { bid, ask } = bidAsk(marketPrice, spread)

  // Legend bar: hovered bar, else the live one.
  const legendBar = hoverBar ?? candleRef.current
  const legendUp = legendBar ? legendBar.close >= legendBar.open : true

  return (
    <section className="flex h-full min-h-0 flex-col bg-background">
      {/* Symbol header — hidden on mobile (shown in compact top bar instead) */}
      {!isMobile && (
        <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-2">
          <div className="flex items-baseline gap-3">
            <h2 className="text-sm font-bold tracking-tight">{asset.symbol}</h2>
            <span className="text-xs text-muted-foreground">{asset.label}</span>
            <span
              className="flex items-center gap-1.5 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-secondary-foreground"
              title={feedTitle}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: feedLive ? "var(--profit)" : "var(--muted-foreground)" }}
              />
              {feedLabel}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <QuoteButton
              side="sell"
              price={bid}
              digits={asset.digits}
              onClick={() => fire("sell")}
              className={cn(isSubmitting && "pointer-events-none opacity-60")}
            />
            <QuoteButton
              side="buy"
              price={ask}
              digits={asset.digits}
              onClick={() => fire("buy")}
              className={cn(isSubmitting && "pointer-events-none opacity-60")}
            />
          </div>
        </div>
      )}

      {/* Timeframes + chart tools */}
      <div
        className={cn(
          "flex items-center justify-between gap-2 border-b border-border px-2 py-1",
          isMobile && "overflow-x-auto scrollbar-none",
        )}
      >
        <div className="flex items-center gap-1">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.seconds}
              type="button"
              onClick={() => setTimeframe(tf.seconds)}
              aria-pressed={timeframe === tf.seconds}
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 font-mono text-[11px] font-medium tabular-nums transition-colors",
                timeframe === tf.seconds
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              {tf.label}
            </button>
          ))}
        </div>
        {!isMobile && (
          <ChartToolbar
            style={chartStyle}
            onStyleChange={setChartStyle}
            indicators={indicators}
            onToggleIndicator={toggleIndicator}
          />
        )}
      </div>

      {/* Chart + interaction overlay */}
      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="absolute inset-0 h-full w-full" />

        {/* OHLC legend (top-left, follows crosshair) */}
        {legendBar && chartStyle === "candles" && !isMobile && (
          <div
            className="pointer-events-none absolute left-2 top-1.5 z-10 flex items-center gap-2 rounded-md bg-card/80 px-2 py-0.5 font-mono text-[10px] tabular-nums backdrop-blur-sm"
            aria-hidden="true"
          >
            <span className="font-sans font-semibold">{asset.symbol}</span>
            <span className="text-muted-foreground">O</span>
            <span className={legendUp ? "text-profit" : "text-loss"}>{formatPrice(legendBar.open, asset.digits)}</span>
            <span className="text-muted-foreground">H</span>
            <span className={legendUp ? "text-profit" : "text-loss"}>{formatPrice(legendBar.high, asset.digits)}</span>
            <span className="text-muted-foreground">L</span>
            <span className={legendUp ? "text-profit" : "text-loss"}>{formatPrice(legendBar.low, asset.digits)}</span>
            <span className="text-muted-foreground">C</span>
            <span className={legendUp ? "text-profit" : "text-loss"}>{formatPrice(legendBar.close, asset.digits)}</span>
          </div>
        )}

        <ChartOverlay chartApiRef={chartApiRef} />
      </div>
    </section>
  )
}
