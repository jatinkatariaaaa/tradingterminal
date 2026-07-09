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

export function readChartColors(): ChartColors {
  const s = getComputedStyle(document.documentElement)
  const v = (name: string, fallback: string) => {
    const val = s.getPropertyValue(name).trim()
    return val || fallback
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
