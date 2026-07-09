"use client"

import { useCallback, useEffect, useState } from "react"
import { Minus, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  bidAsk,
  commissionFor,
  formatMoney,
  formatPrice,
  getAsset,
  marginRequired,
  openFillPrice,
  quoteCurrencyOf,
  roundToLotStep,
  spreadOf,
  usdPerUnit,
} from "@/lib/trading/assets"
import type { OrderType } from "@/lib/trading/types"
import { useTrading } from "./trading-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LocalNumberInput, PriceField, ExecutionBanners } from "./ticket/fields"
import { useExecution } from "./ticket/use-execution"
import { SlTpBlock, RiskRewardLine } from "./ticket/sl-tp-section"
import { VolumeSection } from "./ticket/volume-section"

const ORDER_TYPES: { value: OrderType; label: string }[] = [
  { value: "market", label: "Market" },
  { value: "limit", label: "Limit" },
  { value: "stop", label: "Stop" },
]

export function OrderTicket() {
  const { activeSymbol, marketPrice, prices, derived, draft, setDraft, account } = useTrading()
  const asset = getAsset(activeSymbol)
  const breached = account.status === "breached"

  const priceStep = 1 / 10 ** Math.min(asset.digits, 4)

  // --- Live spread / bid-ask / institutional cost preview. ---
  const spread = spreadOf(asset, marketPrice)
  const { bid, ask } = bidAsk(marketPrice, spread)
  const volume = roundToLotStep(Math.max(asset.lotStep, draft.volume), asset.lotStep)
  // Market orders fill at the spread-adjusted side; pending fill at their trigger.
  const entryFill =
    draft.type === "market" ? openFillPrice(draft.direction, marketPrice, spread) : draft.triggerPrice
  const sign = draft.direction === "buy" ? 1 : -1
  const usdRate = usdPerUnit(quoteCurrencyOf(asset.symbol), prices)
  const commission = commissionFor(volume)
  // SL/TP previews: gross move → USD → net of round-turn commission.
  const pnlAt = (price: number) =>
    (price - entryFill) * sign * volume * asset.contractSize * usdRate - commission
  /** USD P&L per 1.0 of price movement at the current volume (for pips/USD SL-TP modes). */
  const usdPerPriceUnit = volume * asset.contractSize * usdRate

  const notional = volume * asset.contractSize * marketPrice * usdRate
  const marginReq = marginRequired(asset, volume, entryFill, prices)
  // Pre-trade guard to ensure sufficient margin for all order types.
  const insufficientMargin = marginReq > derived.freeMargin
  const tpPreview = draft.tpEnabled ? pnlAt(draft.tpPrice) : null
  const slPreview = draft.slEnabled ? pnlAt(draft.slPrice) : null

  // --- Execution feedback via the shared hook. ---
  const { execute, busy, confirm, rejection } = useExecution()

  // --- Risk-% sizing. ---
  const [autoRisk, setAutoRisk] = useState(false)
  const [riskPct, setRiskPct] = useState(1.0)

  useEffect(() => {
    if (!autoRisk || !draft.slEnabled || !draft.slPrice) return
    const riskUsd = account.balance * (riskPct / 100)
    const entry = draft.type === "market" ? (draft.direction === "buy" ? ask : bid) : draft.triggerPrice
    const distance = Math.abs(entry - draft.slPrice)
    if (distance <= 0) return
    const lossPerLot = distance * asset.contractSize * usdRate
    if (lossPerLot <= 0) return
    let calculatedLots = riskUsd / lossPerLot
    calculatedLots = Math.max(asset.lotStep, roundToLotStep(calculatedLots, asset.lotStep))
    if (draft.volume !== calculatedLots) {
      setDraft({ volume: calculatedLots })
    }
  }, [autoRisk, riskPct, draft.slEnabled, draft.slPrice, draft.type, draft.direction, draft.triggerPrice, ask, bid, account.balance, asset.contractSize, asset.lotStep, usdRate, draft.volume, setDraft])

  return (
    <aside className="flex min-h-0 flex-col overflow-y-auto bg-card" aria-label="Order ticket">
      <div className="border-b border-border px-3 py-2.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Order Ticket
        </h2>
      </div>

      <div className="flex flex-col gap-3.5 p-3">
        {/* Direction toggle — cTrader style: outlined resting, filled active */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setDraft({ direction: "sell" })}
            className={cn(
              "rounded-lg border py-2.5 text-sm font-semibold transition-colors",
              draft.direction === "sell"
                ? "border-[var(--sell)] bg-[var(--sell)] text-[var(--sell-foreground)]"
                : "border-[var(--sell)]/40 bg-transparent text-[var(--sell)] hover:bg-[var(--sell)]/10",
            )}
          >
            <span className="block text-[10px] font-medium uppercase tracking-wider opacity-80">Sell</span>
            <span className="font-mono tabular-nums">{formatPrice(bid, asset.digits)}</span>
          </button>
          <button
            type="button"
            onClick={() => setDraft({ direction: "buy" })}
            className={cn(
              "rounded-lg border py-2.5 text-sm font-semibold transition-colors",
              draft.direction === "buy"
                ? "border-[var(--buy)] bg-[var(--buy)] text-[var(--buy-foreground)]"
                : "border-[var(--buy)]/40 bg-transparent text-[var(--buy)] hover:bg-[var(--buy)]/10",
            )}
          >
            <span className="block text-[10px] font-medium uppercase tracking-wider opacity-80">Buy</span>
            <span className="font-mono tabular-nums">{formatPrice(ask, asset.digits)}</span>
          </button>
        </div>

        {/* Order type tabs */}
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-secondary p-1">
          {ORDER_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setDraft({ type: t.value })}
              className={cn(
                "rounded-md py-1.5 text-xs font-medium transition-colors",
                draft.type === t.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Volume with lots / risk-% sizing modes */}
        <VolumeSection
          volume={draft.volume}
          lotStep={asset.lotStep}
          onVolume={(v) => setDraft({ volume: v })}
          autoRisk={autoRisk}
          onAutoRisk={setAutoRisk}
          riskPct={riskPct}
          onRiskPct={setRiskPct}
          slEnabled={draft.slEnabled}
          roundedVolume={volume}
        />

        {/* Trigger price for limit/stop */}
        {draft.type !== "market" && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-2.5">
            <PriceField
              label={`${draft.type === "limit" ? "Limit" : "Stop"} Price`}
              value={draft.triggerPrice}
              step={priceStep}
              accent="var(--primary)"
              onChange={(v) => setDraft({ triggerPrice: v })}
            />
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Drag the line on the chart to set the trigger.
            </p>
          </div>
        )}

        {/* Stop Loss with price / pips / USD entry */}
        <SlTpBlock
          kind="sl"
          symbol={asset.symbol}
          enabled={draft.slEnabled}
          price={draft.slPrice}
          onToggle={(on) => setDraft({ slEnabled: on })}
          onPrice={(v) => setDraft({ slPrice: v })}
          entryFill={entryFill}
          direction={draft.direction}
          usdPerPriceUnit={usdPerPriceUnit}
          commission={commission}
          priceStep={priceStep}
          preview={slPreview}
        />

        {/* Take Profit with price / pips / USD entry */}
        <SlTpBlock
          kind="tp"
          symbol={asset.symbol}
          enabled={draft.tpEnabled}
          price={draft.tpPrice}
          onToggle={(on) => setDraft({ tpEnabled: on })}
          onPrice={(v) => setDraft({ tpPrice: v })}
          entryFill={entryFill}
          direction={draft.direction}
          usdPerPriceUnit={usdPerPriceUnit}
          commission={commission}
          priceStep={priceStep}
          preview={tpPreview}
        />

        {/* Risk : Reward when both SL and TP set */}
        <RiskRewardLine slPreview={slPreview} tpPreview={tpPreview} />

        {/* Trade cost & margin breakdown */}
        <dl className="flex flex-col gap-1 rounded-lg border border-border bg-secondary/30 p-2.5 text-[11px]">
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Notional</dt>
            <dd className="font-mono tabular-nums">{formatMoney(notional)}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Margin required (1:100)</dt>
            <dd className="font-mono tabular-nums">{formatMoney(marginReq)}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Commission (round-turn)</dt>
            <dd className="font-mono tabular-nums">{formatMoney(commission)}</dd>
          </div>
          <div className="flex items-center justify-between border-t border-border pt-1">
            <dt className="text-muted-foreground">Free margin</dt>
            <dd className={cn("font-mono tabular-nums", insufficientMargin && "text-[var(--loss)]")}>
              {formatMoney(derived.freeMargin)}
            </dd>
          </div>
        </dl>

        {/* Execution confirmation / rejection banners */}
        <ExecutionBanners confirm={confirm} rejection={rejection} digits={asset.digits} />

        {/* Execute */}
        <Button
          type="button"
          disabled={breached || busy || insufficientMargin}
          onClick={execute}
          className={cn(
            "h-11 rounded-lg text-sm font-semibold",
            draft.direction === "buy"
              ? "bg-[var(--buy)] text-[var(--buy-foreground)] hover:bg-[var(--buy)]/90"
              : "bg-[var(--sell)] text-[var(--sell-foreground)] hover:bg-[var(--sell)]/90",
          )}
        >
          {breached
            ? "Account Breached"
            : insufficientMargin
              ? "Insufficient Free Margin"
              : busy
                ? "Order Sent"
                : `${draft.direction === "buy" ? "Buy" : "Sell"} ${volume} ${asset.symbol}`}
        </Button>
      </div>
    </aside>
  )
}

/**
 * Compact execution panel shown below the chart on mobile.
 * Contains: Direction toggle, volume, SL/TP quick toggles, and execute button.
 * Expandable for order type, trigger price, and detailed cost breakdown.
 *
 * When a position/order is being managed (managePositionId is set), this panel
 * switches to "manage mode" showing the trade info, SL/TP controls, and a
 * "Manage ▲" button to open the full ManagePanel overlay.
 */
export function MobileOrderPanel({ onOpenFullManage }: { onOpenFullManage?: () => void }) {
  const {
    activeSymbol,
    marketPrice,
    prices,
    derived,
    draft,
    setDraft,
    account,
    openPositions,
    pendingOrders,
    managePositionId,
    manageSL,
    manageTP,
    setManageSL,
    setManageTP,
    endManage,
    pnlFor,
    modifyPosition,
    modifyOrder,
  } = useTrading()
  const asset = getAsset(activeSymbol)
  const breached = account.status === "breached"

  const priceStep = 1 / 10 ** Math.min(asset.digits, 4)
  const spread = spreadOf(asset, marketPrice)
  const { bid, ask } = bidAsk(marketPrice, spread)
  const volume = roundToLotStep(Math.max(asset.lotStep, draft.volume), asset.lotStep)
  const entryFill =
    draft.type === "market" ? openFillPrice(draft.direction, marketPrice, spread) : draft.triggerPrice
  const sign = draft.direction === "buy" ? 1 : -1
  const usdRate = usdPerUnit(quoteCurrencyOf(asset.symbol), prices)
  const commission = commissionFor(volume)
  const pnlAt = (price: number) =>
    (price - entryFill) * sign * volume * asset.contractSize * usdRate - commission

  const marginReq = marginRequired(asset, volume, entryFill, prices)
  const insufficientMargin = draft.type === "market" && marginReq > derived.freeMargin
  const tpPreview = draft.tpEnabled ? pnlAt(draft.tpPrice) : null
  const slPreview = draft.slEnabled ? pnlAt(draft.slPrice) : null

  const [expanded, setExpanded] = useState(false)

  const adjustVolume = (delta: number) => {
    const next = Math.max(asset.lotStep, Number((draft.volume + delta).toFixed(2)))
    setDraft({ volume: next })
  }

  // --- Execution feedback via the shared hook ---
  const { execute: handleExecute, busy, confirm, rejection } = useExecution()

  // ---- Manage mode: find the managed position or order ----
  const managedPosition = openPositions.find((p) => p.id === managePositionId) ?? null
  const managedOrder = pendingOrders.find((o) => o.id === managePositionId) ?? null
  const isManageMode = managedPosition != null || managedOrder != null

  // Handle SL/TP modification for managed position/order
  const handleApplySLTP = useCallback(async () => {
    if (managedPosition) {
      await modifyPosition(managedPosition.id, manageSL, manageTP)
    } else if (managedOrder) {
      await modifyOrder(managedOrder.id, manageSL, manageTP)
    }
  }, [managedPosition, managedOrder, manageSL, manageTP, modifyPosition, modifyOrder])

  // ---- MANAGE MODE ----
  if (isManageMode && managePositionId) {
    const target = managedPosition ?? managedOrder
    if (!target) return null
    const isBuy = target.direction === "buy"
    const targetAsset = getAsset(target.symbol)
    const entryPrice = managedPosition?.entryPrice ?? managedOrder?.triggerPrice ?? 0
    const livePrice = prices[target.symbol] ?? entryPrice
    const pnl = managedPosition ? pnlFor(managedPosition, livePrice) : null
    const targetPriceStep = 1 / 10 ** Math.min(targetAsset.digits, 4)

    return (
      <div className="flex flex-col border-t border-border bg-background">
        {/* Row 1: Trade info strip */}
        <div className="flex items-center gap-1.5 px-2 pt-2">
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
            style={{
              backgroundColor: isBuy ? "var(--buy)" : "var(--sell)",
              color: isBuy ? "var(--buy-foreground)" : "var(--sell-foreground)",
            }}
          >
            {target.direction}
          </span>
          <span className="text-xs font-semibold">{target.symbol}</span>
          <span className="font-mono text-[10px] text-muted-foreground">
            {'volume' in target ? target.volume : ''} lots
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">
            @ {formatPrice(entryPrice, targetAsset.digits)}
          </span>
          {pnl != null && (
            <span
              className="ml-auto font-mono text-xs font-semibold tabular-nums"
              style={{ color: pnl >= 0 ? "var(--profit)" : "var(--loss)" }}
            >
              {pnl >= 0 ? "+" : ""}{formatMoney(pnl)}
            </span>
          )}
          {managedOrder && (
            <span className="ml-auto text-[10px] font-medium text-muted-foreground uppercase">
              {managedOrder.type} order
            </span>
          )}
        </div>

        {/* Row 2: SL / TP toggle buttons */}
        <div className="flex items-center gap-2 px-2 py-1.5">
          {/* SL toggle */}
          <button
            type="button"
            onClick={() => {
              if (manageSL != null) {
                setManageSL(null)
              } else {
                const pad = entryPrice * 0.005
                const round = (v: number) => Number(v.toFixed(targetAsset.digits))
                setManageSL(round(isBuy ? entryPrice - pad : entryPrice + pad))
              }
            }}
            className={cn(
              "flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold transition-colors",
              manageSL != null
                ? "bg-[var(--loss)]/15 text-[var(--loss)]"
                : "bg-secondary text-muted-foreground",
            )}
          >
            SL {manageSL != null && <span className="font-mono">{formatPrice(manageSL, Math.min(targetAsset.digits, 4))}</span>}
          </button>
          {/* TP toggle */}
          <button
            type="button"
            onClick={() => {
              if (manageTP != null) {
                setManageTP(null)
              } else {
                const pad = entryPrice * 0.005
                const round = (v: number) => Number(v.toFixed(targetAsset.digits))
                setManageTP(round(isBuy ? entryPrice + pad : entryPrice - pad))
              }
            }}
            className={cn(
              "flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold transition-colors",
              manageTP != null
                ? "bg-[var(--profit)]/15 text-[var(--profit)]"
                : "bg-secondary text-muted-foreground",
            )}
          >
            TP {manageTP != null && <span className="font-mono">{formatPrice(manageTP, Math.min(targetAsset.digits, 4))}</span>}
          </button>
          {/* Live bid/ask */}
          <div className="ml-auto flex items-center gap-2 text-[10px] font-mono tabular-nums">
            <span style={{ color: "var(--sell)" }}>{formatPrice(bid, asset.digits)}</span>
            <span className="text-muted-foreground">/</span>
            <span style={{ color: "var(--buy)" }}>{formatPrice(ask, asset.digits)}</span>
          </div>
        </div>

        {/* Row 3: Action buttons */}
        <div className="flex items-center gap-1.5 px-2 pb-2">
          {/* Apply SL/TP changes */}
          <button
            type="button"
            onClick={handleApplySLTP}
            className="flex-1 rounded-md bg-primary py-2 text-xs font-bold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Apply SL/TP
          </button>
          {/* Manage ▲ — opens full manage panel overlay for partial close etc. */}
          {managedPosition && (
            <button
              type="button"
              onClick={onOpenFullManage}
              className="rounded-md bg-secondary px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-secondary/80"
            >
              Manage ▲
            </button>
          )}
          {/* ✕ Deselect */}
          <button
            type="button"
            onClick={endManage}
            className="rounded-md bg-secondary px-2.5 py-2 text-xs text-muted-foreground transition-colors hover:bg-secondary/80 hover:text-foreground"
          >
            ✕
          </button>
        </div>
      </div>
    )
  }

  // ---- NORMAL ORDER MODE ----
  return (
    <div className="flex flex-col border-t border-border bg-background">
      {/* Row 1: cTrader-style trade bar — Sell price | Lots stepper | Buy price */}
      <div className="flex items-stretch gap-1 px-2 pt-2">
        <button
          type="button"
          onClick={() => setDraft({ direction: "sell" })}
          aria-pressed={draft.direction === "sell"}
          className={cn(
            "flex flex-1 flex-col items-start justify-center rounded-l-xl rounded-r-md px-3 py-1.5 transition-colors",
            draft.direction === "sell"
              ? "bg-[var(--sell)] text-[var(--sell-foreground)]"
              : "bg-[var(--sell)]/15 text-[var(--sell)]",
          )}
        >
          <span className="text-[10px] font-semibold uppercase tracking-wide opacity-90">Sell</span>
          <span className="font-mono text-sm font-bold tabular-nums">{formatPrice(bid, asset.digits)}</span>
        </button>
        <div className="flex shrink-0 flex-col items-center justify-center rounded-md bg-secondary px-1.5">
          <span className="text-[9px] uppercase tracking-wide text-muted-foreground">Lots</span>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => adjustVolume(-asset.lotStep * 10)}
              aria-label="Decrease volume"
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground"
            >
              <Minus className="h-3 w-3" />
            </button>
            <LocalNumberInput
              step={asset.lotStep}
              min={asset.lotStep}
              value={draft.volume}
              onChange={(v) => setDraft({ volume: v })}
              onBlurClamp={asset.lotStep}
              aria-label="Volume in lots"
              className="h-6 w-14 border-0 bg-transparent px-0.5 text-center font-mono text-xs tabular-nums"
            />
            <button
              type="button"
              onClick={() => adjustVolume(asset.lotStep * 10)}
              aria-label="Increase volume"
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setDraft({ direction: "buy" })}
          aria-pressed={draft.direction === "buy"}
          className={cn(
            "flex flex-1 flex-col items-end justify-center rounded-l-md rounded-r-xl px-3 py-1.5 transition-colors",
            draft.direction === "buy"
              ? "bg-[var(--buy)] text-[var(--buy-foreground)]"
              : "bg-[var(--buy)]/15 text-[var(--buy)]",
          )}
        >
          <span className="text-[10px] font-semibold uppercase tracking-wide opacity-90">Buy</span>
          <span className="font-mono text-sm font-bold tabular-nums">{formatPrice(ask, asset.digits)}</span>
        </button>
      </div>

      {/* Row 2: SL / TP quick toggles + Bid/Ask */}
      <div className="flex items-center gap-2 px-2 py-1.5">
        {/* SL toggle */}
        <button
          type="button"
          onClick={() => setDraft({ slEnabled: !draft.slEnabled })}
          className={cn(
            "flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold transition-colors",
            draft.slEnabled
              ? "bg-[var(--loss)]/15 text-[var(--loss)]"
              : "bg-secondary text-muted-foreground",
          )}
        >
          SL {draft.slEnabled && <span className="font-mono">{formatPrice(draft.slPrice, Math.min(asset.digits, 4))}</span>}
          {slPreview != null && (
            <span className="font-mono" style={{ color: slPreview >= 0 ? "var(--profit)" : "var(--loss)" }}>
              {slPreview >= 0 ? "+" : ""}{formatMoney(slPreview)}
            </span>
          )}
        </button>
        {/* TP toggle */}
        <button
          type="button"
          onClick={() => setDraft({ tpEnabled: !draft.tpEnabled })}
          className={cn(
            "flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold transition-colors",
            draft.tpEnabled
              ? "bg-[var(--profit)]/15 text-[var(--profit)]"
              : "bg-secondary text-muted-foreground",
          )}
        >
          TP {draft.tpEnabled && <span className="font-mono">{formatPrice(draft.tpPrice, Math.min(asset.digits, 4))}</span>}
          {tpPreview != null && (
            <span className="font-mono" style={{ color: tpPreview >= 0 ? "var(--profit)" : "var(--loss)" }}>
              {tpPreview >= 0 ? "+" : ""}{formatMoney(tpPreview)}
            </span>
          )}
        </button>
        {/* Bid/Ask */}
        <div className="ml-auto flex items-center gap-2 text-[10px] font-mono tabular-nums">
          <span style={{ color: "var(--sell)" }}>{formatPrice(bid, asset.digits)}</span>
          <span className="text-muted-foreground">/</span>
          <span style={{ color: "var(--buy)" }}>{formatPrice(ask, asset.digits)}</span>
        </div>
      </div>

      {/* Expand toggle */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-center py-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
      >
        {expanded ? "▼ Less" : "▲ More options"}
      </button>

      {/* Expanded section: Order type, SL/TP price inputs, cost breakdown */}
      {expanded && (
        <div className="flex flex-col gap-2 px-2 pb-1 animate-in slide-in-from-bottom-2 duration-200">
          {/* Order type */}
          <div className="grid grid-cols-3 gap-1 rounded bg-secondary p-0.5">
            {ORDER_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setDraft({ type: t.value })}
                className={cn(
                  "rounded py-1 text-[10px] font-medium transition-colors",
                  draft.type === t.value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Trigger price for limit/stop */}
          {draft.type !== "market" && (
            <div className="flex items-center justify-between gap-2 rounded bg-primary/5 px-2 py-1.5">
              <span className="text-[10px] font-medium text-primary">
                {draft.type === "limit" ? "Limit" : "Stop"} Price
              </span>
              <Input
                type="number"
                step={priceStep}
                value={draft.triggerPrice}
                onChange={(e) => setDraft({ triggerPrice: Number(e.target.value) })}
                className="h-6 w-28 bg-secondary font-mono text-right text-[11px] tabular-nums px-1"
              />
            </div>
          )}

          {/* SL price input (if enabled) */}
          {draft.slEnabled && (
            <div className="flex items-center justify-between gap-2 rounded bg-secondary/50 px-2 py-1">
              <span className="text-[10px] font-medium" style={{ color: "var(--loss)" }}>SL Price</span>
              <Input
                type="number"
                step={priceStep}
                value={draft.slPrice}
                onChange={(e) => setDraft({ slPrice: Number(e.target.value) })}
                className="h-6 w-28 bg-secondary font-mono text-right text-[11px] tabular-nums px-1"
              />
            </div>
          )}

          {/* TP price input (if enabled) */}
          {draft.tpEnabled && (
            <div className="flex items-center justify-between gap-2 rounded bg-secondary/50 px-2 py-1">
              <span className="text-[10px] font-medium" style={{ color: "var(--profit)" }}>TP Price</span>
              <Input
                type="number"
                step={priceStep}
                value={draft.tpPrice}
                onChange={(e) => setDraft({ tpPrice: Number(e.target.value) })}
                className="h-6 w-28 bg-secondary font-mono text-right text-[11px] tabular-nums px-1"
              />
            </div>
          )}

          {/* Compact cost row */}
          <div className="flex items-center justify-between text-[10px] text-muted-foreground px-0.5">
            <span>Margin: {formatMoney(marginReq)}</span>
            <span>Free: {formatMoney(derived.freeMargin)}</span>
            <span>Comm: {formatMoney(commission)}</span>
          </div>
        </div>
      )}

      {/* Confirmation / Rejection banner */}
      {(confirm || rejection) && (
        <div className="mx-2 mb-1">
          <ExecutionBanners confirm={confirm} rejection={rejection} digits={asset.digits} compact />
        </div>
      )}

      {/* Execute button */}
      <div className="px-2 pb-2">
        <Button
          type="button"
          disabled={breached || busy || insufficientMargin}
          onClick={handleExecute}
          className={cn(
            "h-9 w-full text-xs font-bold",
            draft.direction === "buy"
              ? "bg-[var(--buy)] text-[var(--buy-foreground)] hover:bg-[var(--buy)]/90"
              : "bg-[var(--sell)] text-[var(--sell-foreground)] hover:bg-[var(--sell)]/90",
          )}
        >
          {breached
            ? "Breached"
            : insufficientMargin
              ? "Insufficient Margin"
              : busy
                ? "Sent"
                : `${draft.direction === "buy" ? "Buy" : "Sell"} ${volume} ${asset.symbol}`}
        </Button>
      </div>
    </div>
  )
}

