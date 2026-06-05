import type { RefObject } from "react"

/**
 * Bridge between the lightweight-charts instance (owned by ChartPanel) and the
 * interaction overlay (ChartOverlay). The overlay uses these to map prices to
 * the chart's *real* pixel coordinate system — so every line tracks the price
 * axis correctly when the user pans or zooms vertically.
 */
export interface ChartApi {
  /** Map a price to a Y pixel offset within the chart pane, or null if unavailable. */
  priceToY: (price: number) => number | null
  /** Map a Y pixel offset (relative to the chart pane top) back to a price. */
  yToPrice: (y: number) => number | null
  /** Current height of the chart pane in CSS pixels (excludes the time axis). */
  paneHeight: () => number
}

export type ChartApiRef = RefObject<ChartApi | null>
