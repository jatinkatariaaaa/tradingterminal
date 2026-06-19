"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { AlertTriangle, CheckCircle2, Minus, Plus } from "lucide-react"
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
import { playExecutionSound } from "@/lib/trading/sound"
import { useTrading, type ExecutionFill } from "./trading-provider"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const ORDER_TYPES: { value: OrderType; label: string }[] = [
  { value: "market", label: "Market" },
  { value: "limit", label: "Limit" },
  { value: "stop", label: "Stop" },
]

function LocalNumberInput({
  value,
  onChange,
  onBlurClamp,
  step,
  min,
  className,
  placeholder,
}: {
  value: number
  onChange: (v: number) => void
  onBlurClamp?: number
  step?: number
  min?: number
  className?: string
  placeholder?: string
}) {
  const [local, setLocal] = useState(value.toString())
  const prevValue = useRef(value)
  
  useEffect(() => {
    if (value !== prevValue.current) {
      setLocal(value.toString())
      prevValue.current = value
    }
  }, [value])

  return (
    <Input
      type="number"
      step={step}
      min={min}
      value={local}
      onChange={(e) => {
        setLocal(e.target.value)
        if (e.target.value !== "") {
          onChange(Number(e.target.value))
        }
      }}
      onBlur={() => {
        if (local === "" || (onBlurClamp !== undefined && Number(local) < onBlurClamp)) {
          const clamped = onBlurClamp !== undefined ? onBlurClamp : 0
          setLocal(clamped.toString())
          onChange(clamped)
        }
      }}
      className={className}
      placeholder={placeholder}
    />
  )
}

function PriceField({
  label,
  value,
  onChange,
  step,
  accent,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  step: number
  accent?: string
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Label
        className="text-xs text-muted-foreground"
        style={accent ? { color: accent } : undefined}
      >
        {label}
      </Label>
      <LocalNumberInput
        value={value}
        onChange={onChange}
        step={step}
        className="h-8 w-32 bg-secondary font-mono text-right text-sm tabular-nums"
      />
    </div>
  )
}

export function OrderTicket() {
  const { activeSymbol, marketPrice, prices, derived, draft, setDraft, executeOrder, account } =
    useTrading()
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

  const notional = volume * asset.contractSize * marketPrice * usdRate
  const marginReq = marginRequired(asset, volume, entryFill, prices)
  // Pre-trade guard to ensure sufficient margin for all order types.
  const insufficientMargin = marginReq > derived.freeMargin
  const tpPreview = draft.tpEnabled ? pnlAt(draft.tpPrice) : null
  const slPreview = draft.slEnabled ? pnlAt(draft.slPrice) : null

  const adjustVolume = (delta: number) => {
    const next = Math.max(asset.lotStep, Number((draft.volume + delta).toFixed(2)))
    setDraft({ volume: next })
  }

  // --- Execution feedback (sound + confirmation / rejection banner + guard). ---
  const [confirm, setConfirm] = useState<ExecutionFill | null>(null)
  const [rejection, setRejection] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  // Auto Risk state
  const [autoRisk, setAutoRisk] = useState(false)
  const [riskPct, setRiskPct] = useState(1.0)

  useEffect(() => {
    return () => timers.current.forEach(clearTimeout)
  }, [])

  // Auto-Lot Calculation
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

  const handleExecute = useCallback(async () => {
    if (busy) return // ignore rapid double taps
    setBusy(true)
    try {
      const result = await executeOrder()
      if (!result) {
        setBusy(false)
        return
      }
      if (!result.ok) {
        // Rejected (e.g. not enough free margin) — surface the reason, no fill.
        setConfirm(null)
        setRejection(result.reason)
        timers.current.push(setTimeout(() => setRejection(null), 3600))
        setBusy(false)
        return
      }
      setRejection(null)
      setConfirm(result)
      playExecutionSound(result.direction)
      // Re-enable after a short cooldown so an accidental second tap can't fire
      // another order before the trader sees the confirmation.
      timers.current.push(setTimeout(() => setBusy(false), 900))
      timers.current.push(setTimeout(() => setConfirm(null), 2600))
    } catch {
      setBusy(false)
      setRejection("An unexpected error occurred.")
      timers.current.push(setTimeout(() => setRejection(null), 3600))
    }
  }, [busy, executeOrder])

  return (
    <aside className="flex min-h-0 flex-col overflow-y-auto bg-background">
      <div className="border-b border-border px-3 py-2.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Order Ticket
        </h2>
      </div>

      <div className="flex flex-col gap-4 p-3">
        {/* Direction toggle */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setDraft({ direction: "buy" })}
            className={cn(
              "rounded-md py-2.5 text-sm font-semibold transition-colors",
              draft.direction === "buy"
                ? "bg-[var(--buy)] text-[var(--buy-foreground)]"
                : "bg-secondary text-muted-foreground hover:text-foreground",
            )}
          >
            BUY
          </button>
          <button
            type="button"
            onClick={() => setDraft({ direction: "sell" })}
            className={cn(
              "rounded-md py-2.5 text-sm font-semibold transition-colors",
              draft.direction === "sell"
                ? "bg-[var(--sell)] text-[var(--sell-foreground)]"
                : "bg-secondary text-muted-foreground hover:text-foreground",
            )}
          >
            SELL
          </button>
        </div>

        {/* Order type tabs */}
        <div className="grid grid-cols-3 gap-1 rounded-md bg-secondary p-1">
          {ORDER_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setDraft({ type: t.value })}
              className={cn(
                "rounded py-1.5 text-xs font-medium transition-colors",
                draft.type === t.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Volume & Auto Risk */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">Volume (lots)</Label>
            <div className="flex items-center gap-1.5">
              <Checkbox
                id="autoRisk"
                checked={autoRisk}
                onCheckedChange={(c) => setAutoRisk(c === true)}
              />
              <Label htmlFor="autoRisk" className="text-[10px] uppercase tracking-wider text-muted-foreground cursor-pointer">
                Auto Risk %
              </Label>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {!autoRisk ? (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  onClick={() => adjustVolume(-asset.lotStep * 10)}
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <LocalNumberInput
                  step={asset.lotStep}
                  min={asset.lotStep}
                  value={draft.volume}
                  onChange={(v) => setDraft({ volume: v })}
                  onBlurClamp={asset.lotStep}
                  className="h-9 bg-secondary text-center font-mono text-sm tabular-nums"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  onClick={() => adjustVolume(asset.lotStep * 10)}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <div className="flex w-full items-center gap-2">
                <LocalNumberInput
                  step={0.1}
                  min={0.1}
                  value={riskPct}
                  onChange={(v) => setRiskPct(v)}
                  onBlurClamp={0.1}
                  className="h-9 bg-secondary font-mono text-sm tabular-nums"
                  placeholder="e.g. 1.0"
                />
                <div className="flex h-9 shrink-0 items-center justify-center rounded-md bg-secondary px-3 font-mono text-sm text-muted-foreground">
                  %
                </div>
              </div>
            )}
          </div>
          
          {!autoRisk && volume !== draft.volume && (
            <p className="text-[11px] text-muted-foreground">
              Rounded to {volume} lots (step {asset.lotStep}).
            </p>
          )}
          {autoRisk && !draft.slEnabled && (
            <p className="text-[11px] text-amber-500 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> Enable Stop Loss for Auto Risk.
            </p>
          )}
          {autoRisk && draft.slEnabled && (
            <p className="text-[11px] text-muted-foreground">
              Calculated size: <span className="font-mono text-foreground">{draft.volume}</span> lots
            </p>
          )}
        </div>

        {/* Live bid / ask spread */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-md bg-secondary/60 px-2.5 py-1.5">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Bid</span>
            <p className="font-mono text-sm tabular-nums" style={{ color: "var(--sell)" }}>
              {formatPrice(bid, asset.digits)}
            </p>
          </div>
          <div className="rounded-md bg-secondary/60 px-2.5 py-1.5">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Ask</span>
            <p className="font-mono text-sm tabular-nums" style={{ color: "var(--buy)" }}>
              {formatPrice(ask, asset.digits)}
            </p>
          </div>
        </div>

        {/* Trade cost & margin breakdown */}
        <dl className="flex flex-col gap-1 rounded-md border border-border bg-secondary/30 p-2.5 text-[11px]">
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
            <dd
              className={cn(
                "font-mono tabular-nums",
                insufficientMargin && "text-[var(--loss)]",
              )}
            >
              {formatMoney(derived.freeMargin)}
            </dd>
          </div>
        </dl>

        {/* Trigger price for limit/stop */}
        {draft.type !== "market" && (
          <div className="rounded-md border border-primary/30 bg-primary/5 p-2.5">
            <PriceField
              label={`${draft.type === "limit" ? "Limit" : "Stop"} Price`}
              value={draft.triggerPrice}
              step={priceStep}
              accent="var(--primary)"
              onChange={(v) => setDraft({ triggerPrice: v })}
            />
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Drag the blue line on the chart to set the trigger.
            </p>
          </div>
        )}

        {/* Stop Loss */}
        <div className="flex flex-col gap-2 rounded-md bg-secondary/50 p-2.5">
          <div className="flex items-center gap-2">
            <Checkbox
              id="sl"
              checked={draft.slEnabled}
              onCheckedChange={(c) => setDraft({ slEnabled: Boolean(c) })}
            />
            <Label htmlFor="sl" className="text-xs font-medium" style={{ color: "var(--loss)" }}>
              Stop Loss
            </Label>
          </div>
          {draft.slEnabled && (
            <>
              <PriceField
                label="SL Price"
                value={draft.slPrice}
                step={priceStep}
                onChange={(v) => setDraft({ slPrice: v })}
              />
              {slPreview != null && (
                <p
                  className="text-right font-mono text-xs tabular-nums"
                  style={{ color: slPreview >= 0 ? "var(--profit)" : "var(--loss)" }}
                >
                  {slPreview >= 0 ? "+" : ""}
                  {formatMoney(slPreview)}
                </p>
              )}
            </>
          )}
        </div>

        {/* Take Profit */}
        <div className="flex flex-col gap-2 rounded-md bg-secondary/50 p-2.5">
          <div className="flex items-center gap-2">
            <Checkbox
              id="tp"
              checked={draft.tpEnabled}
              onCheckedChange={(c) => setDraft({ tpEnabled: Boolean(c) })}
            />
            <Label htmlFor="tp" className="text-xs font-medium" style={{ color: "var(--profit)" }}>
              Take Profit
            </Label>
          </div>
          {draft.tpEnabled && (
            <>
              <PriceField
                label="TP Price"
                value={draft.tpPrice}
                step={priceStep}
                onChange={(v) => setDraft({ tpPrice: v })}
              />
              {tpPreview != null && (
                <p
                  className="text-right font-mono text-xs tabular-nums"
                  style={{ color: tpPreview >= 0 ? "var(--profit)" : "var(--loss)" }}
                >
                  {tpPreview >= 0 ? "+" : ""}
                  {formatMoney(tpPreview)}
                </p>
              )}
            </>
          )}
        </div>

        {/* Execution confirmation banner */}
        {confirm && (
          <div
            role="status"
            aria-live="polite"
            className={cn(
              "flex animate-in fade-in items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium",
              confirm.direction === "buy"
                ? "border-[var(--buy)] bg-[var(--buy)]/10 text-[var(--buy)]"
                : "border-[var(--sell)] bg-[var(--sell)]/10 text-[var(--sell)]",
            )}
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>
              {confirm.kind === "pending" ? "Order placed" : "Executed"}:{" "}
              {confirm.direction === "buy" ? "Buy" : "Sell"} {confirm.volume} {confirm.symbol} @{" "}
              {formatPrice(confirm.price, asset.digits)}
            </span>
          </div>
        )}

        {/* Rejection banner (e.g. not enough free margin) */}
        {rejection && (
          <div
            role="alert"
            aria-live="assertive"
            className="flex animate-in fade-in items-start gap-2 rounded-md border border-[var(--loss)] bg-[var(--loss)]/10 px-3 py-2 text-xs font-medium text-[var(--loss)]"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{rejection}</span>
          </div>
        )}

        {/* Execute */}
        <Button
          type="button"
          disabled={breached || busy || insufficientMargin}
          onClick={handleExecute}
          className={cn(
            "h-11 text-sm font-semibold",
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
                ? "Order Sent ✓"
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
 */
export function MobileOrderPanel() {
  const { activeSymbol, marketPrice, prices, derived, draft, setDraft, executeOrder, account } =
    useTrading()
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

  // --- Execution feedback ---
  const [confirm, setConfirm] = useState<ExecutionFill | null>(null)
  const [rejection, setRejection] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    return () => timers.current.forEach(clearTimeout)
  }, [])

  const handleExecute = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      const result = await executeOrder()
      if (!result) { setBusy(false); return }
      if (!result.ok) {
        setConfirm(null)
        setRejection(result.reason)
        timers.current.push(setTimeout(() => setRejection(null), 3600))
        setBusy(false)
        return
      }
      setRejection(null)
      setConfirm(result)
      playExecutionSound(result.direction)
      timers.current.push(setTimeout(() => setBusy(false), 900))
      timers.current.push(setTimeout(() => setConfirm(null), 2600))
    } catch {
      setBusy(false)
      setRejection("An unexpected error occurred.")
      timers.current.push(setTimeout(() => setRejection(null), 3600))
    }
  }, [busy, executeOrder])

  return (
    <div className="flex flex-col border-t border-border bg-background">
      {/* Row 1: BUY / SELL + Volume */}
      <div className="flex items-center gap-1.5 px-2 pt-2">
        <button
          type="button"
          onClick={() => setDraft({ direction: "buy" })}
          className={cn(
            "flex-1 rounded-md py-2 text-xs font-bold transition-colors",
            draft.direction === "buy"
              ? "bg-[var(--buy)] text-[var(--buy-foreground)]"
              : "bg-secondary text-muted-foreground",
          )}
        >
          BUY
        </button>
        <button
          type="button"
          onClick={() => setDraft({ direction: "sell" })}
          className={cn(
            "flex-1 rounded-md py-2 text-xs font-bold transition-colors",
            draft.direction === "sell"
              ? "bg-[var(--sell)] text-[var(--sell-foreground)]"
              : "bg-secondary text-muted-foreground",
          )}
        >
          SELL
        </button>
        <div className="flex items-center gap-0.5 ml-1">
          <button
            type="button"
            onClick={() => adjustVolume(-asset.lotStep * 10)}
            className="flex h-7 w-7 items-center justify-center rounded bg-secondary text-muted-foreground"
          >
            <Minus className="h-3 w-3" />
          </button>
          <LocalNumberInput
            step={asset.lotStep}
            min={asset.lotStep}
            value={draft.volume}
            onChange={(v) => setDraft({ volume: v })}
            onBlurClamp={asset.lotStep}
            className="h-7 w-16 bg-secondary text-center font-mono text-xs tabular-nums px-1"
          />
          <button
            type="button"
            onClick={() => adjustVolume(asset.lotStep * 10)}
            className="flex h-7 w-7 items-center justify-center rounded bg-secondary text-muted-foreground"
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>
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
      {confirm && (
        <div
          role="status"
          className={cn(
            "mx-2 mb-1 flex items-center gap-1.5 rounded px-2 py-1 text-[10px] font-medium animate-in fade-in",
            confirm.direction === "buy"
              ? "bg-[var(--buy)]/10 text-[var(--buy)]"
              : "bg-[var(--sell)]/10 text-[var(--sell)]",
          )}
        >
          <CheckCircle2 className="h-3 w-3 shrink-0" />
          {confirm.direction === "buy" ? "Buy" : "Sell"} {confirm.volume} @ {formatPrice(confirm.price, asset.digits)}
        </div>
      )}
      {rejection && (
        <div
          role="alert"
          className="mx-2 mb-1 flex items-center gap-1.5 rounded bg-[var(--loss)]/10 px-2 py-1 text-[10px] font-medium text-[var(--loss)] animate-in fade-in"
        >
          <AlertTriangle className="h-3 w-3 shrink-0" />
          {rejection}
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
                ? "Sent ✓"
                : `${draft.direction === "buy" ? "Buy" : "Sell"} ${volume} ${asset.symbol}`}
        </Button>
      </div>
    </div>
  )
}
