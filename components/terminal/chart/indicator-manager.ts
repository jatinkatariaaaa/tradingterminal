import {
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
} from "lightweight-charts"
import {
  bollinger,
  ema,
  macd,
  rsi,
  sma,
  INDICATOR_PANE,
  type IndicatorId,
  type OhlcBar,
} from "./indicators"

type AnySeries = ISeriesApi<"Line"> | ISeriesApi<"Histogram">

interface Entry {
  id: IndicatorId
  series: AnySeries[]
}

function cssVar(name: string): string {
  if (typeof window === "undefined") return "#888"
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || "#888"
}

/**
 * Owns every indicator series on a chart. Recomputes from the full bar
 * array (cheap at <=600 bars) whenever data or the active set changes.
 * Overlay indicators go on pane 0; RSI/MACD get their own panes.
 */
export class IndicatorManager {
  private chart: IChartApi
  private entries = new Map<IndicatorId, Entry>()

  constructor(chart: IChartApi) {
    this.chart = chart
  }

  /** Sync the mounted series set with the requested indicator ids. */
  sync(active: IndicatorId[], bars: OhlcBar[]) {
    // Remove indicators that are no longer active.
    for (const [id, entry] of this.entries) {
      if (!active.includes(id)) {
        for (const s of entry.series) this.chart.removeSeries(s)
        this.entries.delete(id)
      }
    }
    // Add newly-activated indicators.
    for (const id of active) {
      if (!this.entries.has(id)) {
        this.entries.set(id, { id, series: this.create(id) })
      }
    }
    this.update(bars)
  }

  /** Recompute every active indicator from the full bar array. */
  update(bars: OhlcBar[]) {
    for (const entry of this.entries.values()) {
      this.applyData(entry, bars)
    }
  }

  /** Re-resolve theme colors (call after a light/dark switch). */
  refreshColors() {
    for (const entry of this.entries.values()) {
      const colors = this.colorsFor(entry.id)
      entry.series.forEach((s, i) => {
        if (s.seriesType() === "Line") {
          ;(s as ISeriesApi<"Line">).applyOptions({ color: colors[i] })
        }
      })
    }
  }

  destroy() {
    for (const entry of this.entries.values()) {
      for (const s of entry.series) {
        try {
          this.chart.removeSeries(s)
        } catch {
          // chart may already be disposed
        }
      }
    }
    this.entries.clear()
  }

  private colorsFor(id: IndicatorId): string[] {
    switch (id) {
      case "sma20":
        return [cssVar("--chart-3")]
      case "ema50":
        return [cssVar("--chart-4")]
      case "bb20":
        return [cssVar("--chart-5"), cssVar("--chart-5"), cssVar("--chart-5")]
      case "rsi14":
        return [cssVar("--chart-3")]
      case "macd":
        return [cssVar("--chart-3"), cssVar("--chart-4")]
    }
  }

  private create(id: IndicatorId): AnySeries[] {
    const pane = INDICATOR_PANE[id]
    const colors = this.colorsFor(id)
    const base = { priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }
    switch (id) {
      case "sma20":
      case "ema50":
        return [
          this.chart.addSeries(LineSeries, { ...base, color: colors[0], lineWidth: 1 }, pane),
        ]
      case "bb20": {
        const mk = (dashed: boolean) =>
          this.chart.addSeries(
            LineSeries,
            { ...base, color: colors[0], lineWidth: 1, lineStyle: dashed ? 2 : 0 },
            pane,
          )
        return [mk(false), mk(true), mk(true)] // middle, upper, lower
      }
      case "rsi14":
        return [
          this.chart.addSeries(LineSeries, { ...base, color: colors[0], lineWidth: 1 }, pane),
        ]
      case "macd":
        return [
          this.chart.addSeries(HistogramSeries, { ...base, color: cssVar("--chart-grid") }, INDICATOR_PANE.macd),
          this.chart.addSeries(LineSeries, { ...base, color: colors[0], lineWidth: 1 }, INDICATOR_PANE.macd),
          this.chart.addSeries(LineSeries, { ...base, color: colors[1], lineWidth: 1 }, INDICATOR_PANE.macd),
        ]
    }
  }

  private applyData(entry: Entry, bars: OhlcBar[]) {
    switch (entry.id) {
      case "sma20":
        ;(entry.series[0] as ISeriesApi<"Line">).setData(sma(bars, 20))
        break
      case "ema50":
        ;(entry.series[0] as ISeriesApi<"Line">).setData(ema(bars, 50))
        break
      case "bb20": {
        const bb = bollinger(bars, 20, 2)
        ;(entry.series[0] as ISeriesApi<"Line">).setData(bb.middle)
        ;(entry.series[1] as ISeriesApi<"Line">).setData(bb.upper)
        ;(entry.series[2] as ISeriesApi<"Line">).setData(bb.lower)
        break
      }
      case "rsi14":
        ;(entry.series[0] as ISeriesApi<"Line">).setData(rsi(bars, 14))
        break
      case "macd": {
        const m = macd(bars)
        const up = cssVar("--chart-up")
        const down = cssVar("--chart-down")
        ;(entry.series[0] as ISeriesApi<"Histogram">).setData(
          m.histogram.map((p) => ({ ...p, color: p.value >= 0 ? up : down })),
        )
        ;(entry.series[1] as ISeriesApi<"Line">).setData(m.macd)
        ;(entry.series[2] as ISeriesApi<"Line">).setData(m.signal)
        break
      }
    }
  }
}
