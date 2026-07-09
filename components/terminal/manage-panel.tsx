"use client"

import { useEffect, useState } from "react"
import { ArrowLeft, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatMoney, formatPrice, getAsset } from "@/lib/trading/assets"
import { useTrading } from "./trading-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"

/**
 * Position manager rendered in the right panel (replacing the Order Ticket
 * while a position is being managed). The SL/TP price fields are bound to the
 * provider's live `manageSL`/`manageTP` state, which is the SAME state the
 * chart overlay drags — so editing a number moves the line and dragging the
 * line updates the number.
 */
export function ManagePanel() {
  const {
    openPositions,
    pendingOrders,
    managePositionId,
    manageSL,
    manageTP,
    setManageSL,
    setManageTP,
    endManage,
    prices,
    pnlFor,
    partialClose,
    closePosition,
    modifyPosition,
    modifyOrder,
    cancelPending,
  } = useTrading()

  const position = openPositions.find((p) => p.id === managePositionId) ?? null
  const order = pendingOrders.find((o) => o.id === managePositionId) ?? null

  const [closeVol, setCloseVol] = useState(0)
  useEffect(() => {
    if (position) setCloseVol(Number((position.volume / 2).toFixed(2)))
  }, [managePositionId, position?.volume])

  // A pending order was clicked — show the order manager instead of blanking out.
  if (!position && order) {
    return (
      <PendingOrderManager
        order={order}
        manageSL={manageSL}
        manageTP={manageTP}
        setManageSL={setManageSL}
        setManageTP={setManageTP}
        endManage={endManage}
        modifyOrder={modifyOrder}
        cancelPending={cancelPending}
        livePrice={prices[order.symbol] ?? order.triggerPrice}
      />
    )
  }

  if (!position) return null

  const asset = getAsset(position.symbol)
  const livePrice = prices[position.symbol] ?? position.entryPrice
  const pnl = pnlFor(position, livePrice)
  const priceStep = 1 / 10 ** Math.min(asset.digits, 4)
  const maxClose = position.volume
  const partialPnl = pnlFor({ ...position, volume: closeVol }, livePrice)
  const isFullClose = closeVol >= maxClose
  const isBuy = position.direction === "buy"

  // What the SL/TP would realize at their trigger prices.
  const pnlAt = (price: number) =>
    (price - position.entryPrice) * (isBuy ? 1 : -1) * position.volume * asset.contractSize

  const handlePartialClose = async () => {
    if (closeVol <= 0) return
    if (isFullClose) await closePosition(position.id)
    else await partialClose(position.id, closeVol)
  }

  // Commit the working SL/TP to the position via the server, then close the manager.
  const handleModify = async () => {
    await modifyPosition(position.id, manageSL, manageTP)
    endManage()
  }

  // Default level prices when a trader first enables SL/TP from the panel.
  const pad = position.entryPrice * 0.005
  const round = (v: number) => Number(v.toFixed(asset.digits))
  const defaultSL = round(isBuy ? position.entryPrice - pad : position.entryPrice + pad)
  const defaultTP = round(isBuy ? position.entryPrice + pad : position.entryPrice - pad)

  return (
    <aside className="flex min-h-0 flex-col overflow-y-auto bg-background">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <button
          type="button"
          onClick={endManage}
          className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Manage Position
        </button>
        <button
          type="button"
          onClick={endManage}
          aria-label="Close manager"
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-col gap-4 p-3">
        {/* Position summary */}
        <div className="rounded-md bg-secondary/50 p-3">
          <div className="flex items-center gap-2">
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
              style={{
                backgroundColor: isBuy ? "var(--buy)" : "var(--sell)",
                color: isBuy ? "var(--buy-foreground)" : "var(--sell-foreground)",
              }}
            >
              {position.direction}
            </span>
            <span className="text-sm font-semibold">{position.symbol}</span>
            <span className="font-mono text-xs text-muted-foreground">{position.volume} lots</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              Entry {formatPrice(position.entryPrice, asset.digits)}
            </span>
            <span className="text-muted-foreground">
              Market {formatPrice(livePrice, asset.digits)}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Floating P&L</span>
            <span
              className="font-mono text-sm font-semibold tabular-nums"
              style={{ color: pnl >= 0 ? "var(--profit)" : "var(--loss)" }}
            >
              {pnl >= 0 ? "+" : ""}
              {formatMoney(pnl)}
            </span>
          </div>
        </div>

        {/* Drag hint */}
        <p className="rounded-md border border-primary/30 bg-primary/5 px-2.5 py-2 text-[11px] text-muted-foreground">
          Drag the <span className="font-medium" style={{ color: "var(--loss)" }}>SL</span> and{" "}
          <span className="font-medium" style={{ color: "var(--profit)" }}>TP</span> lines on the
          chart to automatically adjust your position.
        </p>

        {/* Stop Loss */}
        <LevelEditor
          label="Stop Loss"
          color="var(--loss)"
          price={manageSL}
          step={priceStep}
          digits={asset.digits}
          onEnable={() => setManageSL(defaultSL)}
          onDisable={() => setManageSL(null)}
          onChange={(v) => setManageSL(v)}
          preview={manageSL != null ? pnlAt(manageSL) : null}
        />

        {/* Take Profit */}
        <LevelEditor
          label="Take Profit"
          color="var(--profit)"
          price={manageTP}
          step={priceStep}
          digits={asset.digits}
          onEnable={() => setManageTP(defaultTP)}
          onDisable={() => setManageTP(null)}
          onChange={(v) => setManageTP(v)}
          preview={manageTP != null ? pnlAt(manageTP) : null}
        />

        {/* Partial close */}
        <div className="flex flex-col gap-2.5 rounded-md bg-secondary/50 p-2.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium">Close Volume</Label>
            <span className="font-mono text-xs tabular-nums">
              {closeVol.toFixed(2)} / {maxClose} lots
            </span>
          </div>
          <Slider
            value={[closeVol]}
            min={0}
            max={maxClose}
            step={asset.lotStep}
            onValueChange={(v) => setCloseVol(Number(v[0].toFixed(2)))}
          />
          <p className="text-right text-[11px] text-muted-foreground">
            Realized if closed:{" "}
            <span
              className="font-mono font-semibold"
              style={{ color: partialPnl >= 0 ? "var(--profit)" : "var(--loss)" }}
            >
              {partialPnl >= 0 ? "+" : ""}
              {formatMoney(partialPnl)}
            </span>
          </p>
          <Button
            type="button"
            variant="secondary"
            onClick={handlePartialClose}
            disabled={closeVol <= 0}
            className="w-full"
          >
            {isFullClose ? "Close Full Position" : `Close ${closeVol.toFixed(2)} Lots`}
          </Button>
        </div>

        {/* Apply SL/TP changes */}
        <Button
          type="button"
          onClick={handleModify}
          className="h-11 text-sm font-semibold"
        >
          Modify
        </Button>
      </div>
    </aside>
  )
}

/**
 * Right-panel manager for a pending (limit/stop) order. Shown when the trader
 * clicks a pending order line on the chart. SL/TP fields share the provider's
 * manageSL/manageTP state so dragging chart lines stays in sync.
 */
function PendingOrderManager({
  order,
  manageSL,
  manageTP,
  setManageSL,
  setManageTP,
  endManage,
  modifyOrder,
  cancelPending,
  livePrice,
}: {
  order: {
    id: string
    symbol: string
    type: string
    direction: string
    volume: number
    triggerPrice: number
    stopLoss: number | null
    takeProfit: number | null
  }
  manageSL: number | null
  manageTP: number | null
  setManageSL: (v: number | null) => void
  setManageTP: (v: number | null) => void
  endManage: () => void
  modifyOrder: (id: string, stopLoss: number | null, takeProfit: number | null) => Promise<void>
  cancelPending: (id: string) => Promise<void>
  livePrice: number
}) {
  const asset = getAsset(order.symbol)
  const isBuy = order.direction === "buy"
  const priceStep = 1 / 10 ** Math.min(asset.digits, 4)

  // Projected P&L at a level, assuming the order fills at its trigger price.
  const pnlAt = (price: number) =>
    (price - order.triggerPrice) * (isBuy ? 1 : -1) * order.volume * asset.contractSize

  // Default level prices when enabling SL/TP from the panel (20-pip style pad).
  const pad = Math.max(order.triggerPrice * 0.001, priceStep * 200)
  const round = (v: number) => Number(v.toFixed(asset.digits))
  const defaultSL = round(isBuy ? order.triggerPrice - pad : order.triggerPrice + pad)
  const defaultTP = round(isBuy ? order.triggerPrice + pad : order.triggerPrice - pad)

  const handleModify = async () => {
    await modifyOrder(order.id, manageSL, manageTP)
    endManage()
  }

  const handleCancel = async () => {
    await cancelPending(order.id)
    endManage()
  }

  return (
    <aside className="flex min-h-0 flex-col overflow-y-auto bg-background">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <button
          type="button"
          onClick={endManage}
          className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Manage Order
        </button>
        <button
          type="button"
          onClick={endManage}
          aria-label="Close manager"
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-col gap-4 p-3">
        {/* Order summary */}
        <div className="rounded-md bg-secondary/50 p-3">
          <div className="flex items-center gap-2">
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
              style={{
                backgroundColor: isBuy ? "var(--buy)" : "var(--sell)",
                color: isBuy ? "var(--buy-foreground)" : "var(--sell-foreground)",
              }}
            >
              {order.direction}
            </span>
            <span className="text-sm font-semibold">{order.symbol}</span>
            <span className="font-mono text-xs text-muted-foreground">{order.volume} lots</span>
            <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
              {order.type}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              Trigger {formatPrice(order.triggerPrice, asset.digits)}
            </span>
            <span className="text-muted-foreground">
              Market {formatPrice(livePrice, asset.digits)}
            </span>
          </div>
        </div>

        {/* Drag hint */}
        <p className="rounded-md border border-primary/30 bg-primary/5 px-2.5 py-2 text-[11px] text-muted-foreground">
          Drag the <span className="font-medium" style={{ color: "var(--loss)" }}>SL</span> and{" "}
          <span className="font-medium" style={{ color: "var(--profit)" }}>TP</span> lines on the
          chart to adjust this order&apos;s levels.
        </p>

        {/* Stop Loss */}
        <LevelEditor
          label="Stop Loss"
          color="var(--loss)"
          price={manageSL}
          step={priceStep}
          digits={asset.digits}
          onEnable={() => setManageSL(defaultSL)}
          onDisable={() => setManageSL(null)}
          onChange={(v) => setManageSL(v)}
          preview={manageSL != null ? pnlAt(manageSL) : null}
        />

        {/* Take Profit */}
        <LevelEditor
          label="Take Profit"
          color="var(--profit)"
          price={manageTP}
          step={priceStep}
          digits={asset.digits}
          onEnable={() => setManageTP(defaultTP)}
          onDisable={() => setManageTP(null)}
          onChange={(v) => setManageTP(v)}
          preview={manageTP != null ? pnlAt(manageTP) : null}
        />

        {/* Apply SL/TP changes */}
        <Button type="button" onClick={handleModify} className="h-11 text-sm font-semibold">
          Modify Order
        </Button>

        {/* Cancel the pending order entirely */}
        <Button
          type="button"
          variant="outline"
          onClick={handleCancel}
          className="h-10 border-[var(--loss)]/40 text-sm font-semibold text-[var(--loss)] hover:bg-[var(--loss)]/10 hover:text-[var(--loss)]"
        >
          Cancel Order
        </Button>
      </div>
    </aside>
  )
}

function LevelEditor({
  label,
  color,
  price,
  step,
  digits,
  onEnable,
  onDisable,
  onChange,
  preview,
}: {
  label: string
  color: string
  price: number | null
  step: number
  digits: number
  onEnable: () => void
  onDisable: () => void
  onChange: (v: number) => void
  preview: number | null
}) {
  const enabled = price != null
  return (
    <div className="flex flex-col gap-2 rounded-md bg-secondary/50 p-2.5">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => (enabled ? onDisable() : onEnable())}
          aria-pressed={enabled}
          className={cn(
            "flex h-6 items-center gap-1.5 rounded px-2 text-[11px] font-semibold uppercase tracking-wide transition-colors",
            enabled ? "text-background" : "bg-muted text-muted-foreground",
          )}
          style={enabled ? { backgroundColor: color } : undefined}
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: enabled ? "currentColor" : color }}
          />
          {label}
        </button>
        {enabled && (
          <button
            type="button"
            onClick={onDisable}
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            Remove
          </button>
        )}
      </div>
      {enabled && (
        <>
          <Input
            type="number"
            step={step}
            value={price ?? ""}
            onChange={(e) => onChange(Number(Number(e.target.value).toFixed(digits)))}
            className="h-8 bg-background font-mono text-right text-sm tabular-nums"
            aria-label={`${label} price`}
          />
          {preview != null && (
            <p
              className="text-right font-mono text-xs tabular-nums"
              style={{ color: preview >= 0 ? "var(--profit)" : "var(--loss)" }}
            >
              {preview >= 0 ? "+" : ""}
              {formatMoney(preview)}
            </p>
          )}
        </>
      )}
    </div>
  )
}
