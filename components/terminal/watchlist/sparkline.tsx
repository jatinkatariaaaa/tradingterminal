"use client"

import { useId, useMemo } from "react"

/**
 * Tiny inline area sparkline (cTrader watchlist style). Pure SVG — no chart
 * library — so hundreds of rows stay cheap. Color follows the day direction.
 */
export function Sparkline({
  data,
  positive,
  width = 72,
  height = 28,
}: {
  data: number[]
  positive: boolean
  width?: number
  height?: number
}) {
  const gradId = useId()

  const { line, area } = useMemo(() => {
    if (data.length < 2) return { line: "", area: "" }
    let min = Infinity
    let max = -Infinity
    for (const v of data) {
      if (v < min) min = v
      if (v > max) max = v
    }
    const span = max - min || 1
    const stepX = width / (data.length - 1)
    const pad = 2
    const usable = height - pad * 2
    const pts = data.map((v, i) => {
      const x = i * stepX
      const y = pad + usable - ((v - min) / span) * usable
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    const line = `M${pts.join(" L")}`
    const area = `${line} L${width},${height} L0,${height} Z`
    return { line, area }
  }, [data, width, height])

  if (!line) {
    return <div style={{ width, height }} aria-hidden="true" />
  }

  const color = positive ? "var(--profit)" : "var(--loss)"

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="shrink-0">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}
