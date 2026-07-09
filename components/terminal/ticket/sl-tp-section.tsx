"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { formatMoney } from "@/lib/trading/assets"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { LocalNumberInput } from "./fields"
import { pipsToPrice, priceToPips, roundToDigits } from "./pip-utils"

type EntryMode = "price" | "pips" | "usd"

const MODES: { value: EntryMode; label: string }[] = [
  { value: "price", label: "Price" },
  { value: "pips", label: "Pips" },
  { value: "usd", label: "USD" },
]

/**
 * One SL or TP block with three entry modes:
 *  - Price: absolute price level
 *  - Pips:  distance from the entry fill in pips
 *  - USD:   target P&L in dollars (converted through lot size)
 * The canonical value is always the absolute price stored in the draft; the
 * pips/usd inputs are projections that write back through conversion.
 */
export function SlTpBlock({
  kind,
  symbol,
  enabled,
  price,
  onToggle,
  onPrice,
  entryFill,
  direction,
  usdPerPriceUnit,
  commission,
  priceStep,
  preview,
}: {
  kind: "sl" | "tp"
  symbol: string
  enabled: boolean
  price: number
  onToggle: (enabled: boolean) => void
  onPrice: (price: number) => void
  entryFill: number
  direction: "buy" | "sell"
  /** USD P&L per 1.0 of price movement at the current volume. */
  usdPerPriceUnit: number
  commission: number
  priceStep: number
  preview: number | null
}) {
  const [mode, setMode] = useState<EntryMode>("price")
  const isSL = kind === "sl"
  const accent = isSL ? "var(--loss)" : "var(--profit)"
  const label = isSL ? "Stop Loss" : "Take Profit"
  const sign = direction === "buy" ? 1 : -1

  // Current distance representations derived from the canonical price.
  const pips = Math.abs(priceToPips(symbol, price - entryFill))
  const usd = Math.abs((price - entryFill) * sign * usdPerPriceUnit)

  const applyPips = (p: number) => {
    const dist = pipsToPrice(symbol, Math.max(0, p))
    // SL sits on the losing side of entry, TP on the winning side.
    const dirSign = isSL ? -sign : sign
    onPrice(roundToDigits(symbol, entryFill + dirSign * dist))
  }

  const applyUsd = (u: number) => {
    if (usdPerPriceUnit <= 0) return
    const dist = Math.max(0, u) / usdPerPriceUnit
    const dirSign = isSL ? -sign : sign
    onPrice(roundToDigits(symbol, entryFill + dirSign * dist))
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-secondary/50 p-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Checkbox id={kind} checked={enabled} onCheckedChange={(c) => onToggle(Boolean(c))} />
          <Label htmlFor={kind} className="text-xs font-medium" style={{ color: accent }}>
            {label}
          </Label>
        </div>
        {enabled && (
          <div className="flex rounded-md bg-secondary p-0.5" role="tablist" aria-label={`${label} entry mode`}>
            {MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                role="tab"
                aria-selected={mode === m.value}
                onClick={() => setMode(m.value)}
                className={cn(
                  "rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
                  mode === m.value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {enabled && (
        <>
          {mode === "price" && (
            <LocalNumberInput
              value={price}
              onChange={onPrice}
              step={priceStep}
              aria-label={`${label} price`}
              className="h-8 bg-secondary text-right font-mono text-sm tabular-nums"
            />
          )}
          {mode === "pips" && (
            <div className="flex items-center gap-2">
              <LocalNumberInput
                value={Number(pips.toFixed(1))}
                onChange={applyPips}
                step={1}
                min={0}
                aria-label={`${label} distance in pips`}
                className="h-8 bg-secondary text-right font-mono text-sm tabular-nums"
              />
              <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">pips</span>
            </div>
          )}
          {mode === "usd" && (
            <div className="flex items-center gap-2">
              <LocalNumberInput
                value={Number(usd.toFixed(2))}
                onChange={applyUsd}
                step={10}
                min={0}
                aria-label={`${label} amount in USD`}
                className="h-8 bg-secondary text-right font-mono text-sm tabular-nums"
              />
              <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">USD</span>
            </div>
          )}
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

/** Risk:reward summary line shown when both SL and TP are enabled. */
export function RiskRewardLine({
  slPreview,
  tpPreview,
}: {
  slPreview: number | null
  tpPreview: number | null
}) {
  if (slPreview == null || tpPreview == null) return null
  const risk = Math.abs(Math.min(slPreview, 0))
  const reward = Math.max(tpPreview, 0)
  if (risk <= 0) return null
  const rr = reward / risk
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-secondary/30 px-2.5 py-1.5 text-[11px]">
      <span className="text-muted-foreground">Risk : Reward</span>
      <span
        className="font-mono font-semibold tabular-nums"
        style={{ color: rr >= 1.5 ? "var(--profit)" : rr >= 1 ? "var(--warning)" : "var(--loss)" }}
      >
        1 : {rr.toFixed(2)}
      </span>
    </div>
  )
}
