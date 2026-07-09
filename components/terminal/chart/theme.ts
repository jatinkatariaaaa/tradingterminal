/**
 * Reads the terminal's chart color tokens from the resolved CSS custom
 * properties so the lightweight-charts canvas always matches the active
 * theme (light or dark). Call again whenever `resolvedTheme` changes.
 */
export interface ChartColors {
  up: string
  down: string
  grid: string
  axisText: string
  border: string
  crosshair: string
  profit: string
  loss: string
  primary: string
  warning: string
  foreground: string
  mutedForeground: string
}

/**
 * Resolves any CSS color (oklch, lab, var-derived, named) to an rgba()
 * string that lightweight-charts' canvas renderer can parse. Modern browsers
 * serialize oklch computed styles as lab(), which the chart cannot parse, so
 * we paint 1px onto a canvas and read the pixel back — always rgba.
 */
let probeCtx: CanvasRenderingContext2D | null = null

export function toRgb(value: string, fallback: string): string {
  if (!value) return fallback
  if (!probeCtx) {
    const canvas = document.createElement("canvas")
    canvas.width = 1
    canvas.height = 1
    probeCtx = canvas.getContext("2d", { willReadFrequently: true })
  }
  if (!probeCtx) return fallback
  try {
    probeCtx.clearRect(0, 0, 1, 1)
    probeCtx.fillStyle = value
    probeCtx.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = probeCtx.getImageData(0, 0, 1, 1).data
    return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`
  } catch {
    return fallback
  }
}

export function readChartColors(): ChartColors {
  const s = getComputedStyle(document.documentElement)
  const v = (name: string, fallback: string) => {
    const val = s.getPropertyValue(name).trim()
    return toRgb(val, fallback)
  }
  return {
    up: v("--chart-up", "#26a269"),
    down: v("--chart-down", "#e8590c"),
    grid: v("--chart-grid", "rgba(128,128,128,0.08)"),
    axisText: v("--chart-axis-text", "#6b7280"),
    border: v("--chart-border", "rgba(128,128,128,0.15)"),
    crosshair: v("--chart-crosshair", "rgba(128,128,128,0.5)"),
    profit: v("--profit", "#26a269"),
    loss: v("--loss", "#e8590c"),
    primary: v("--primary", "#111111"),
    warning: v("--warning", "#e9a23b"),
    foreground: v("--foreground", "#111111"),
    mutedForeground: v("--muted-foreground", "#6b7280"),
  }
}
