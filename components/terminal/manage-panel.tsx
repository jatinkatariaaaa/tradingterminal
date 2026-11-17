"use client"

import { useEffect, useState } from "react"
import { ArrowLeft, MousePointerClick, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatMoney, formatPrice, getAsset, quoteCurrencyOf, usdPerUnit } from "@/lib/trading/assets"
import { useTrading } from "./trading-provider"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { LocalNumberInput } from "./ticket/fields"
import { priceToPips } from "./ticket/pip-utils"
import { DirChip, money, pnlTone } from "./kit"
import { stamp } from "./mobile/ui"

function Header({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 pt-2.5 pb-1.5">
      <button type="button" onClick={onClose} className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase transition-colors hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> {title}
      </button>
      <button type="button" onClick={onClose} aria-label="Close manager" className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

function DragHint() {
  return (
    <p className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
      <MousePointerClick className="h-3.5 w-3.5 shrink-0" /> You can also drag the stop and target lines on the chart.
    </p>
  )
}

/** Right-panel manager for an open position or a pending order. */
export function ManagePanel() {
  const { openPositions, pendingOrders, managePositionId, manageSL, manageTP, setManageSL, setManageTP, endManage, prices, pnlFor, partialClose, closePosition, modifyPosition, modifyOrder, cancelPending } = useTrading()

  const position = openPositions.find((p) => p.id === managePositionId) ?? null
  const order = pendingOrders.find((o) => o.id === managePositionId) ?? null

  const [closeVol, setCloseVol] = useState(0)
  useEffect(() => {
    if (position) setCloseVol(Number((position.volume / 2).toFixed(2)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [managePositionId, position?.volume])

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
        usdRate={usdPerUnit(quoteCurrencyOf(order.symbol), prices)}
      />
    )
  }
  if (!position) return null

  const asset = getAsset(position.symbol)
  const livePrice = prices[position.symbol] ?? position.entryPrice
  const pnl = pnlFor(position, livePrice)
  const priceStep = 1 / 10 ** Math.min(asset.digits, 4)
  const isBuy = position.direction === "buy"
  const usdRate = usdPerUnit(quoteCurrencyOf(position.symbol), prices)
  const partialPnl = pnlFor({ ...position, volume: closeVol }, livePrice)
  const isFullClose = closeVol >= position.volume
  const movePips = priceToPips(position.symbol, (livePrice - position.entryPrice) * (isBuy ? 1 : -1))

  // What the stop or target would realize, in dollars, at its trigger price.
  const pnlAt = (price: number) => (price - position.entryPrice) * (isBuy ? 1 : -1) * position.volume * asset.contractSize * usdRate

  const pad = position.entryPrice * 0.005
  const round = (v: number) => Number(v.toFixed(asset.digits))
  const defaultSL = round(isBuy ? position.entryPrice - pad : position.entryPrice + pad)
  const defaultTP = round(isBuy ? position.entryPrice + pad : position.entryPrice - pad)
  const changed = manageSL !== position.stopLoss || manageTP !== position.takeProfit

  return (
    <aside className="flex h-full min-h-0 flex-col bg-card">
      <Header title="Position" onClose={endManage} />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 scrollbar-thin">
        <div className="grid gap-3">
          <div className="rounded-xl border border-border bg-background/60 p-3">
            <div className="flex items-center gap-2">
              <DirChip direction={position.direction} />
              <span className="text-[14px] font-semibold">{position.symbol}</span>
              <span className="font-mono text-[12px] text-muted-foreground">{position.volume} lots</span>
            </div>
            <p className={cn("mt-2 font-mono text-[24px] leading-tight font-semibold tracking-tight tabular-nums", pnlTone(pnl))}>{money(pnl, { sign: true })}</p>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11.5px]">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Open</dt>
                <dd className="font-mono tabular-nums">{formatPrice(position.entryPrice, asset.digits)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Now</dt>
                <dd className="font-mono tabular-nums">{formatPrice(livePrice, asset.digits)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Move</dt>
                <dd className={cn("font-mono tabular-nums", pnlTone(movePips))}>
                  {movePips > 0 ? "+" : ""}
                  {movePips.toFixed(1)} pips
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Margin</dt>
                <dd className="font-mono tabular-nums">{formatMoney(position.margin)}</dd>
              </div>
              <div className="col-span-2 flex justify-between gap-2">
                <dt className="text-muted-foreground">Opened</dt>
                <dd className="font-mono tabular-nums">{stamp(position.openedAt)}</dd>
              </div>
            </dl>
          </div>

          <LevelEditor label="Stop loss" kind="sl" price={manageSL} step={priceStep} digits={asset.digits} onEnable={() => setManageSL(defaultSL)} onDisable={() => setManageSL(null)} onChange={setManageSL} preview={manageSL != null ? pnlAt(manageSL) : null} />
          <LevelEditor label="Take profit" kind="tp" price={manageTP} step={priceStep} digits={asset.digits} onEnable={() => setManageTP(defaultTP)} onDisable={() => setManageTP(null)} onChange={setManageTP} preview={manageTP != null ? pnlAt(manageTP) : null} />
          <DragHint />
          <button
            type="button"
            disabled={!changed}
            onClick={async () => {
              await modifyPosition(position.id, manageSL, manageTP)
              endManage()
            }}
            className="h-11 rounded-xl bg-primary text-[13.5px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {changed ? "Save stop and target" : "No changes to save"}
          </button>

          <section className="mt-1 grid gap-2.5 rounded-xl border border-border p-3">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-semibold">Close position</span>
              <span className="font-mono text-[11.5px] text-muted-foreground tabular-nums">
                {closeVol.toFixed(2)} of {position.volume} lots
              </span>
            </div>
            <Slider value={[closeVol]} min={0} max={position.volume} step={asset.lotStep} onValueChange={(v) => setCloseVol(Number(v[0].toFixed(2)))} />
            <div className="grid grid-cols-4 gap-1">
              {[0.25, 0.5, 0.75, 1].map((f) => {
                const v = Math.max(asset.lotStep, Number((Math.floor((position.volume * f) / asset.lotStep) * asset.lotStep).toFixed(2)))
                return (
                  <button key={f} type="button" onClick={() => setCloseVol(v)} className={cn("h-7 rounded-lg text-[11.5px] font-semibold transition-colors", closeVol === v ? "bg-foreground text-background" : "bg-secondary text-muted-foreground hover:text-foreground")}>
                    {f * 100}%
                  </button>
                )
              })}
            </div>
            <div className="flex items-center justify-between text-[11.5px]">
              <span className="text-muted-foreground">Realized if closed now</span>
              <span className={cn("font-mono font-semibold tabular-nums", pnlTone(partialPnl))}>{money(partialPnl, { sign: true })}</span>
            </div>
            <button
              type="button"
              disabled={closeVol <= 0}
              onClick={async () => {
                if (closeVol <= 0) return
                if (isFullClose) await closePosition(position.id)
                else await partialClose(position.id, closeVol)
              }}
              className={cn("h-10 rounded-xl text-[13px] font-semibold transition-colors disabled:opacity-40", isFullClose ? "bg-loss text-white hover:bg-loss/90" : "border border-loss/40 text-loss hover:bg-loss/10")}
            >
              {isFullClose ? "Close the whole position" : `Close ${closeVol.toFixed(2)} lots`}
            </button>
          </section>
        </div>
      </div>
    </aside>
  )
}

/** Manager for a pending limit or stop order: its protection levels, or cancel it. */
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
  usdRate,
}: {
  order: { id: string; symbol: string; type: string; direction: string; volume: number; triggerPrice: number; stopLoss: number | null; takeProfit: number | null }
  manageSL: number | null
  manageTP: number | null
  setManageSL: (v: number | null) => void
  setManageTP: (v: number | null) => void
  endManage: () => void
  modifyOrder: (id: string, stopLoss: number | null, takeProfit: number | null) => Promise<void>
  cancelPending: (id: string) => Promise<void>
  livePrice: number
  usdRate: number
}) {
  const asset = getAsset(order.symbol)
  const isBuy = order.direction === "buy"
  const priceStep = 1 / 10 ** Math.min(asset.digits, 4)
  // Projected result at a level, assuming the order fills at its trigger.
  const pnlAt = (price: number) => (price - order.triggerPrice) * (isBuy ? 1 : -1) * order.volume * asset.contractSize * usdRate
  const pad = Math.max(order.triggerPrice * 0.001, priceStep * 200)
  const round = (v: number) => Number(v.toFixed(asset.digits))
  const defaultSL = round(isBuy ? order.triggerPrice - pad : order.triggerPrice + pad)
  const defaultTP = round(isBuy ? order.triggerPrice + pad : order.triggerPrice - pad)
  const changed = manageSL !== order.stopLoss || manageTP !== order.takeProfit

  return (
    <aside className="flex h-full min-h-0 flex-col bg-card">
      <Header title="Pending order" onClose={endManage} />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 scrollbar-thin">
        <div className="grid gap-3">
          <div className="rounded-xl border border-border bg-background/60 p-3">
            <div className="flex items-center gap-2">
              <DirChip direction={order.direction === "buy" ? "buy" : "sell"} />
              <span className="text-[14px] font-semibold">{order.symbol}</span>
              <span className="font-mono text-[12px] text-muted-foreground">{order.volume} lots</span>
              <span className="ml-auto rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground uppercase">{order.type}</span>
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11.5px]">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Trigger</dt>
                <dd className="font-mono font-semibold tabular-nums">{formatPrice(order.triggerPrice, asset.digits)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Now</dt>
                <dd className="font-mono tabular-nums">{formatPrice(livePrice, asset.digits)}</dd>
              </div>
              <div className="col-span-2 flex justify-between gap-2">
                <dt className="text-muted-foreground">Distance</dt>
                <dd className="font-mono tabular-nums">{Math.round(Math.abs(livePrice - order.triggerPrice) * 10 ** asset.digits).toLocaleString("en-US")} pts</dd>
              </div>
            </dl>
          </div>

          <LevelEditor label="Stop loss" kind="sl" price={manageSL} step={priceStep} digits={asset.digits} onEnable={() => setManageSL(defaultSL)} onDisable={() => setManageSL(null)} onChange={setManageSL} preview={manageSL != null ? pnlAt(manageSL) : null} />
          <LevelEditor label="Take profit" kind="tp" price={manageTP} step={priceStep} digits={asset.digits} onEnable={() => setManageTP(defaultTP)} onDisable={() => setManageTP(null)} onChange={setManageTP} preview={manageTP != null ? pnlAt(manageTP) : null} />
          <DragHint />
          <button
            type="button"
            disabled={!changed}
            onClick={async () => {
              await modifyOrder(order.id, manageSL, manageTP)
              endManage()
            }}
            className="h-11 rounded-xl bg-primary text-[13.5px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {changed ? "Save stop and target" : "No changes to save"}
          </button>
          <button
            type="button"
            onClick={async () => {
              await cancelPending(order.id)
              endManage()
            }}
            className="h-10 rounded-xl border border-loss/40 text-[13px] font-semibold text-loss transition-colors hover:bg-loss/10"
          >
            Cancel this order
          </button>
        </div>
      </div>
    </aside>
  )
}

function LevelEditor({
  label,
  kind,
  price,
  step,
  digits,
  onEnable,
  onDisable,
  onChange,
  preview,
}: {
  label: string
  kind: "sl" | "tp"
  price: number | null
  step: number
  digits: number
  onEnable: () => void
  onDisable: () => void
  onChange: (v: number) => void
  preview: number | null
}) {
  const enabled = price != null
  const isSL = kind === "sl"
  return (
    <section className={cn("rounded-xl border p-2.5 transition-colors", enabled ? (isSL ? "border-loss/30 bg-loss/[0.04]" : "border-profit/30 bg-profit/[0.04]") : "border-border")}>
      <label className="flex cursor-pointer items-center gap-2">
        <Switch checked={enabled} onCheckedChange={(c) => (c ? onEnable() : onDisable())} aria-label={label} className={cn(enabled && (isSL ? "data-[state=checked]:bg-loss" : "data-[state=checked]:bg-profit"))} />
        <span className={cn("text-[12px] font-semibold", enabled ? (isSL ? "text-loss" : "text-profit") : "text-muted-foreground")}>{label}</span>
        {enabled && preview != null ? <span className={cn("ml-auto font-mono text-[11.5px] font-semibold tabular-nums", pnlTone(preview))}>{money(preview, { sign: true })}</span> : null}
      </label>
      {enabled ? (
        <div className="mt-2 flex h-9 items-center rounded-lg border border-border bg-background focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
          <LocalNumberInput
            value={price ?? 0}
            onChange={(v) => onChange(Number(v.toFixed(digits)))}
            step={step}
            aria-label={`${label} price`}
            className="h-full flex-1 border-0 bg-transparent text-right font-mono text-[13px] font-semibold tabular-nums shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
        </div>
      ) : null}
    </section>
  )
}
