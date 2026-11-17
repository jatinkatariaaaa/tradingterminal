"use client"

import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, Lock, Minus, Plus } from "lucide-react"
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
import { LocalNumberInput, ExecutionBanners } from "./ticket/fields"
import { BigPrice } from "./kit"
import { useExecution } from "./ticket/use-execution"
import { SlTpBlock, RiskRewardLine } from "./ticket/sl-tp-section"
import { VolumeSection } from "./ticket/volume-section"
import { pipsToPrice, roundToDigits } from "./ticket/pip-utils"

const ORDER_TYPES: { value: OrderType; label: string }[] = [
  { value: "market", label: "Market" },
  { value: "limit", label: "Limit" },
  { value: "stop", label: "Stop" },
]

const LOCKED: Record<string, { title: string; text: string }> = {
  breached: { title: "This account is breached", text: "A loss limit was reached, so the account is closed for trading. Its history stays here to review." },
  passed: { title: "Phase passed", text: "Trading is closed on this phase. Your next account is issued in the dashboard." },
  suspended: { title: "Trading is paused", text: "The People Prop has paused this account. Contact support from the dashboard for details." },
  none: { title: "No account selected", text: "Pick an account from the switcher in the top bar." },
}

function Line({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className={cn("font-mono font-medium tabular-nums", tone)}>{v}</dd>
    </div>
  )
}

/** Desktop order ticket: direction, order type, size, protection, a cost summary and the confirm button. */
export function OrderTicket() {
  const { activeSymbol, marketPrice, prices, derived, draft, setDraft, account } = useTrading()
  const asset = getAsset(activeSymbol)
  const locked = !account.tradable
  const lockInfo = LOCKED[account.status] ?? LOCKED.none

  const priceStep = 1 / 10 ** Math.min(asset.digits, 4)
  const spread = spreadOf(asset, marketPrice)
  const { bid, ask } = bidAsk(marketPrice, spread)
  const volume = roundToLotStep(Math.max(asset.lotStep, draft.volume), asset.lotStep)
  // Market orders fill at the spread-adjusted side; pending orders at their trigger.
  const entryFill = draft.type === "market" ? openFillPrice(draft.direction, marketPrice, spread) : draft.triggerPrice
  const sign = draft.direction === "buy" ? 1 : -1
  const usdRate = usdPerUnit(quoteCurrencyOf(asset.symbol), prices)
  const commission = commissionFor(volume)
  const pnlAt = (price: number) => (price - entryFill) * sign * volume * asset.contractSize * usdRate - commission
  /** USD P&L per 1.0 of price movement at the current volume (for pips and dollar SL/TP entry). */
  const usdPerPriceUnit = volume * asset.contractSize * usdRate
  const pipValue = pipsToPrice(asset.symbol, 1) * asset.contractSize * usdRate * volume

  const notional = volume * asset.contractSize * marketPrice * usdRate
  const marginReq = marginRequired(asset, volume, entryFill, prices, account.leverage)
  const insufficientMargin = marginReq > derived.freeMargin
  const tpPreview = draft.tpEnabled ? pnlAt(draft.tpPrice) : null
  const slPreview = draft.slEnabled ? pnlAt(draft.slPrice) : null
  const dailyLeft = Math.max(0, derived.dailyDrawdownLimit - derived.dailyDrawdownUsed)
  const slBreaches = slPreview != null && -slPreview > dailyLeft

  const { execute, busy, confirm, rejection } = useExecution()

  const [autoRisk, setAutoRisk] = useState(false)
  const [riskPct, setRiskPct] = useState(1.0)

  /**
   * Default SL/TP distance: 20 pips, but at least 0.1% of price so high-priced
   * symbols still get a sensible offset. Recomputed from the live entry each time
   * a level is switched on, so its line appears right by the price on the chart.
   */
  const defaultSlTpPrice = useCallback(
    (kind: "sl" | "tp") => {
      const dist = Math.max(pipsToPrice(asset.symbol, 20), entryFill * 0.001)
      const dirSign = kind === "sl" ? -sign : sign
      return roundToDigits(asset.symbol, entryFill + dirSign * dist)
    },
    [asset.symbol, entryFill, sign],
  )

  useEffect(() => {
    if (!autoRisk || !draft.slEnabled || !draft.slPrice) return
    const riskUsd = account.balance * (riskPct / 100)
    const entry = draft.type === "market" ? (draft.direction === "buy" ? ask : bid) : draft.triggerPrice
    const distance = Math.abs(entry - draft.slPrice)
    if (distance <= 0) return
    const lossPerLot = distance * asset.contractSize * usdRate
    if (lossPerLot <= 0) return
    const lots = Math.max(asset.lotStep, roundToLotStep(riskUsd / lossPerLot, asset.lotStep))
    if (draft.volume !== lots) setDraft({ volume: lots })
  }, [autoRisk, riskPct, draft.slEnabled, draft.slPrice, draft.type, draft.direction, draft.triggerPrice, ask, bid, account.balance, asset.contractSize, asset.lotStep, usdRate, draft.volume, setDraft])

  const verb = draft.direction === "buy" ? "Buy" : "Sell"
  const cta = locked
    ? lockInfo.title
    : insufficientMargin
      ? "Not enough free margin"
      : busy
        ? "Sending…"
        : draft.type === "market"
          ? `${verb} ${volume} ${asset.symbol} at market`
          : `Place ${verb.toLowerCase()} ${draft.type} · ${volume} lots`

  return (
    <aside className="flex h-full min-h-0 flex-col bg-card" aria-label="Order ticket">
      <div className="flex items-center justify-between gap-2 px-3 pt-2.5 pb-1.5">
        <h2 className="text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">New order</h2>
        <span className="flex items-center gap-1.5 text-[11.5px]">
          <span className="font-semibold">{asset.symbol}</span>
          <span className="rounded-md bg-secondary px-1.5 py-px font-mono text-[10.5px] text-muted-foreground tabular-nums">{Math.round(spread * 10 ** asset.digits)} pts</span>
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 scrollbar-thin">
        <div className="grid gap-3">
          {locked ? (
            <div className="flex items-start gap-2.5 rounded-xl border border-warning/30 bg-warning/10 p-3 text-[12px]">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <div>
                <p className="font-semibold">{lockInfo.title}</p>
                <p className="mt-0.5 leading-relaxed text-muted-foreground">{lockInfo.text}</p>
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-1.5">
            {(["sell", "buy"] as const).map((d) => {
              const on = draft.direction === d
              const isBuy = d === "buy"
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDraft({ direction: d })}
                  aria-pressed={on}
                  className={cn(
                    "flex flex-col rounded-xl border px-3 py-2 transition-colors",
                    isBuy ? "items-end" : "items-start",
                    on
                      ? isBuy
                        ? "border-buy bg-buy text-buy-foreground"
                        : "border-sell bg-sell text-sell-foreground"
                      : isBuy
                        ? "border-buy/35 text-buy hover:bg-buy/10"
                        : "border-sell/35 text-sell hover:bg-sell/10",
                  )}
                >
                  <span className="text-[10px] font-bold tracking-[0.12em] uppercase opacity-85">{d}</span>
                  <BigPrice price={isBuy ? ask : bid} digits={asset.digits} className="text-[20px] text-current" tone={null} />
                </button>
              )
            })}
          </div>

          <div className="grid grid-cols-3 gap-0.5 rounded-xl bg-secondary p-0.5" role="tablist" aria-label="Order type">
            {ORDER_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                role="tab"
                aria-selected={draft.type === t.value}
                onClick={() => setDraft({ type: t.value })}
                className={cn("h-8 rounded-[10px] text-[12px] font-semibold transition-colors", draft.type === t.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
              >
                {t.label}
              </button>
            ))}
          </div>

          {draft.type !== "market" ? (
            <section className="rounded-xl border border-volt/40 bg-volt/[0.06] p-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-semibold">{draft.type === "limit" ? "Limit price" : "Stop price"}</span>
                <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                  {Math.round(Math.abs(draft.triggerPrice - marketPrice) * 10 ** asset.digits).toLocaleString("en-US")} pts away
                </span>
              </div>
              <div className="mt-2 flex h-9 items-center rounded-lg border border-border bg-background focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
                <LocalNumberInput
                  value={draft.triggerPrice}
                  onChange={(v) => setDraft({ triggerPrice: v })}
                  step={priceStep}
                  aria-label="Trigger price"
                  className="h-full flex-1 border-0 bg-transparent text-right font-mono text-[13px] font-semibold tabular-nums shadow-none focus-visible:ring-0 dark:bg-transparent"
                />
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">Or drag the dashed line on the chart.</p>
            </section>
          ) : null}

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
            footnote={
              <p className="text-[11px] text-muted-foreground">
                {formatMoney(notional)} notional · {formatMoney(pipValue)} per pip
              </p>
            }
          />

          <SlTpBlock
            kind="sl"
            symbol={asset.symbol}
            enabled={draft.slEnabled}
            price={draft.slPrice}
            onToggle={(on) => setDraft(on ? { slEnabled: true, slPrice: defaultSlTpPrice("sl") } : { slEnabled: false })}
            onPrice={(v) => setDraft({ slPrice: v })}
            entryFill={entryFill}
            direction={draft.direction}
            usdPerPriceUnit={usdPerPriceUnit}
            priceStep={priceStep}
            preview={slPreview}
          />
          <SlTpBlock
            kind="tp"
            symbol={asset.symbol}
            enabled={draft.tpEnabled}
            price={draft.tpPrice}
            onToggle={(on) => setDraft(on ? { tpEnabled: true, tpPrice: defaultSlTpPrice("tp") } : { tpEnabled: false })}
            onPrice={(v) => setDraft({ tpPrice: v })}
            entryFill={entryFill}
            direction={draft.direction}
            usdPerPriceUnit={usdPerPriceUnit}
            priceStep={priceStep}
            preview={tpPreview}
          />
          <RiskRewardLine slPreview={slPreview} tpPreview={tpPreview} />

          {slBreaches && !locked ? (
            <p className="flex items-start gap-2 rounded-xl bg-loss/10 px-3 py-2 text-[11.5px] text-loss">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> If this stop is hit the loss is larger than the {formatMoney(dailyLeft)} left in today&apos;s limit, and the account would breach first.
            </p>
          ) : null}

          <dl className="grid gap-1.5 rounded-xl border border-border bg-background/50 p-3 text-[11.5px]">
            <Line k={`Margin (1:${account.leverage})`} v={formatMoney(marginReq)} />
            <Line k="Free margin after" v={formatMoney(derived.freeMargin - marginReq)} tone={insufficientMargin ? "text-loss" : undefined} />
            <Line k="Commission, round turn" v={formatMoney(commission)} />
            <Line k="Daily loss room" v={formatMoney(dailyLeft)} />
          </dl>
        </div>
      </div>

      <div className="grid gap-2 border-t border-border p-3">
        <ExecutionBanners confirm={confirm} rejection={rejection} digits={asset.digits} />
        <button
          type="button"
          disabled={locked || busy || insufficientMargin}
          onClick={execute}
          className={cn(
            "h-12 rounded-xl text-[14px] font-semibold transition-[filter,opacity] hover:brightness-105 disabled:opacity-45",
            draft.direction === "buy" ? "bg-buy text-buy-foreground" : "bg-sell text-sell-foreground",
          )}
        >
          {cta}
        </button>
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
  const breached = !account.tradable

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

  const marginReq = marginRequired(asset, volume, entryFill, prices, account.leverage)
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
          onClick={() =>
            setDraft(
              draft.slEnabled
                ? { slEnabled: false }
                : {
                    slEnabled: true,
                    slPrice: roundToDigits(
                      asset.symbol,
                      entryFill - sign * Math.max(pipsToPrice(asset.symbol, 20), entryFill * 0.001),
                    ),
                  },
            )
          }
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
          onClick={() =>
            setDraft(
              draft.tpEnabled
                ? { tpEnabled: false }
                : {
                    tpEnabled: true,
                    tpPrice: roundToDigits(
                      asset.symbol,
                      entryFill + sign * Math.max(pipsToPrice(asset.symbol, 20), entryFill * 0.001),
                    ),
                  },
            )
          }
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

