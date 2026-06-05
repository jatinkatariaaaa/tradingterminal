"use client"

import { useCallback, useEffect, useRef } from "react"
import { GripHorizontal } from "lucide-react"
import { formatMoney, formatPrice, getAsset } from "@/lib/trading/assets"
import { useTrading } from "./trading-provider"
import type { ChartApiRef } from "./chart-api"

type LineKind = "marker" | "position" | "order"
type DragKey = "trigger" | "sl" | "tp" | "manage-sl" | "manage-tp"

interface OverlayItem {
  key: string
  price: number
  kind: LineKind
  label: string
  color: string
  dashed: boolean
  money: number | null
  drag: DragKey | null
  onDragStart?: () => void
}

const DARK = "oklch(0.16 0.012 255)"

/**
 * Transparent interaction layer over the lightweight-charts canvas.
 *
 * Every line (live price marker, executed entries, draggable order lines) is
 * positioned each animation frame using the chart's real price->pixel mapping
 * (`chartApi.priceToY`). Because that mapping reflects the chart's current
 * vertical scale, all lines stay glued to the price axis when the user pans or
 * zooms. Dragging converts the pointer's Y back to a price via `yToPrice`.
 */
export function ChartOverlay({ chartApiRef }: { chartApiRef: ChartApiRef }) {
  const {
    activeSymbol,
    marketPrice,
    draft,
    setDraft,
    openPositions,
    pnlFor,
    managePositionId,
    manageSL,
    manageTP,
    setManageSL,
    setManageTP,
    selectedPositionId,
    beginManage,
  } = useTrading()
  const asset = getAsset(activeSymbol)

  const managed = openPositions.find((p) => p.id === managePositionId) ?? null

  const containerRef = useRef<HTMLDivElement>(null)
  const elsRef = useRef<Map<string, HTMLDivElement | null>>(new Map())
  const itemsRef = useRef<OverlayItem[]>([])

  // ---- Build the current set of lines. ----------------------------------
  const entryRef = draft.type === "market" ? marketPrice : draft.triggerPrice
  const sign = draft.direction === "buy" ? 1 : -1
  const pnlAt = (price: number) => (price - entryRef) * sign * draft.volume * asset.contractSize

  const items: OverlayItem[] = []

  items.push({
    key: "marker",
    price: marketPrice,
    kind: "marker",
    label: formatPrice(marketPrice, asset.digits),
    color: "var(--primary)",
    dashed: true,
    money: null,
    drag: null,
  })

  for (const p of openPositions) {
    if (p.symbol !== activeSymbol) continue
    const isBuy = p.direction === "buy"
    const isManaged = managed?.id === p.id
    const sign = isBuy ? 1 : -1
    const pnlAt = (price: number) =>
      (price - p.entryPrice) * sign * p.volume * asset.contractSize

    items.push({
      key: `pos-${p.id}`,
      price: p.entryPrice,
      kind: "position",
      label: `${isBuy ? "BUY" : "SELL"} ${p.volume} @ ${formatPrice(p.entryPrice, asset.digits)}`,
      color: isBuy ? "var(--buy)" : "var(--sell)",
      dashed: false,
      money: pnlFor(p, marketPrice),
      drag: null,
    })

    // SL/TP lines for this position.
    // They are only rendered if the position is currently selected in the table
    // OR if the position is actively being managed. For the position being managed,
    // the lines are bound to the live manage state and become draggable;
    // otherwise they are shown static.
    const isSelected = selectedPositionId === p.id
    if (isManaged || isSelected) {
      const sl = isManaged ? manageSL : p.stopLoss
      const tp = isManaged ? manageTP : p.takeProfit
      if (sl != null) {
        items.push({
          key: `sl-${p.id}`,
          price: sl,
          kind: "order",
          label: `SL ${formatPrice(sl, asset.digits)}`,
          color: "var(--loss)",
          dashed: true,
          money: pnlAt(sl),
          drag: "manage-sl",
          onDragStart: () => {
            if (!isManaged) beginManage(p.id)
          },
        })
      }
      if (tp != null) {
        items.push({
          key: `tp-${p.id}`,
          price: tp,
          kind: "order",
          label: `TP ${formatPrice(tp, asset.digits)}`,
          color: "var(--profit)",
          dashed: true,
          money: pnlAt(tp),
          drag: "manage-tp",
          onDragStart: () => {
            if (!isManaged) beginManage(p.id)
          },
        })
      }
    }
  }

  if (draft.type !== "market") {
    items.push({
      key: "order-trigger",
      price: draft.triggerPrice,
      kind: "order",
      label: `${draft.type === "limit" ? "Limit" : "Stop"} ${formatPrice(draft.triggerPrice, asset.digits)}`,
      color: "var(--primary)",
      dashed: false,
      money: null,
      drag: "trigger",
    })
  }
  if (draft.tpEnabled) {
    items.push({
      key: "order-tp",
      price: draft.tpPrice,
      kind: "order",
      label: `TP ${formatPrice(draft.tpPrice, asset.digits)}`,
      color: "var(--profit)",
      dashed: true,
      money: pnlAt(draft.tpPrice),
      drag: "tp",
    })
  }
  if (draft.slEnabled) {
    items.push({
      key: "order-sl",
      price: draft.slPrice,
      kind: "order",
      label: `SL ${formatPrice(draft.slPrice, asset.digits)}`,
      color: "var(--loss)",
      dashed: true,
      money: pnlAt(draft.slPrice),
      drag: "sl",
    })
  }
  itemsRef.current = items

  // ---- Position every line each animation frame. ------------------------
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const api = chartApiRef.current
      const h = api?.paneHeight() ?? 0
      for (const item of itemsRef.current) {
        const el = elsRef.current.get(item.key)
        if (!el) continue
        const y = api?.priceToY(item.price) ?? null
        if (y == null || y < 0 || y > h) {
          el.style.visibility = "hidden"
        } else {
          el.style.visibility = "visible"
          el.style.top = `${y}px`
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [chartApiRef])

  // ---- Dragging order lines. --------------------------------------------
  const dragKeyRef = useRef<DragKey | null>(null)
  const rafRef = useRef(0)
  const pendingRef = useRef<number | null>(null)

  const applyPending = useCallback(() => {
    rafRef.current = 0
    const key = dragKeyRef.current
    const price = pendingRef.current
    if (key == null || price == null) return
    if (key === "trigger") setDraft({ triggerPrice: price })
    else if (key === "sl") setDraft({ slPrice: price })
    else if (key === "tp") setDraft({ tpPrice: price })
    else if (key === "manage-sl") setManageSL(price)
    else if (key === "manage-tp") setManageTP(price)
  }, [setDraft, setManageSL, setManageTP])

  useEffect(() => {
    const getY = (e: MouseEvent | TouchEvent) => {
      if ("touches" in e) return e.touches[0]?.clientY ?? 0
      return e.clientY
    }
    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!dragKeyRef.current || !containerRef.current) return
      if ("cancelable" in e && e.cancelable) e.preventDefault()
      const api = chartApiRef.current
      const rect = containerRef.current.getBoundingClientRect()
      const y = Math.min(rect.height, Math.max(0, getY(e) - rect.top))
      const price = api?.yToPrice(y)
      if (price == null) return
      pendingRef.current = Number(price.toFixed(asset.digits))
      if (!rafRef.current) rafRef.current = requestAnimationFrame(applyPending)
    }
    const onUp = () => {
      dragKeyRef.current = null
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    window.addEventListener("touchmove", onMove, { passive: false })
    window.addEventListener("touchend", onUp)
    return () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
      window.removeEventListener("touchmove", onMove)
      window.removeEventListener("touchend", onUp)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [applyPending, chartApiRef, asset.digits])

  return (
    <div ref={containerRef} className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {items.map((item) => (
        <div
          key={item.key}
          ref={(el) => {
            elsRef.current.set(item.key, el)
          }}
          onMouseDown={
            item.drag
              ? () => {
                  dragKeyRef.current = item.drag
                  item.onDragStart?.()
                }
              : undefined
          }
          onTouchStart={
            item.drag
              ? () => {
                  dragKeyRef.current = item.drag
                  item.onDragStart?.()
                }
              : undefined
          }
          className={
            "absolute inset-x-0 -translate-y-1/2" +
            (item.drag ? " group pointer-events-auto cursor-ns-resize py-1.5" : "")
          }
          style={{ top: "-9999px", visibility: "hidden" }}
        >
          <div className="relative flex items-center">
            <div
              className={item.kind === "marker" ? "h-0 flex-1 border-t" : "h-0 flex-1 border-t-2"}
              style={{
                borderColor: item.kind === "marker" ? "color-mix(in oklch, var(--primary) 35%, transparent)" : item.color,
                borderStyle: item.dashed ? "dashed" : "solid",
              }}
            />
            {item.drag && (
              <span
                className="absolute left-2 -translate-y-1/2 rounded p-0.5 opacity-70 transition-opacity group-hover:opacity-100"
                style={{ backgroundColor: item.color }}
              >
                <GripHorizontal className="h-3 w-3" style={{ color: DARK }} />
              </span>
            )}
            {item.kind === "position" && (
              <div
                className="absolute left-2 -translate-y-1/2 flex items-center gap-2 rounded px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums shadow-sm"
                style={{ backgroundColor: item.color, color: DARK }}
              >
                <span>{item.label}</span>
                {item.money != null && (
                  <span className="border-l border-black/20 pl-2">
                    {item.money >= 0 ? "+" : ""}
                    {formatMoney(item.money)}
                  </span>
                )}
              </div>
            )}
            {item.kind !== "position" && (
              <div
                className="absolute right-14 -translate-y-1/2 flex items-center gap-2 rounded px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums shadow-sm"
                style={{
                  backgroundColor: item.kind === "marker" ? "var(--primary)" : item.color,
                  color: item.kind === "marker" ? "var(--primary-foreground)" : DARK,
                }}
              >
                <span>{item.label}</span>
                {item.money != null && (
                  <span className="border-l border-black/20 pl-2">
                    {item.money >= 0 ? "+" : ""}
                    {formatMoney(item.money)}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
