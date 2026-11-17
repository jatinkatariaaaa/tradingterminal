"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { Switch } from "@/components/ui/switch"
import { LocalNumberInput } from "./fields"
import { pipsToPrice, priceToPips, roundToDigits } from "./pip-utils"
import { Segmented } from "./volume-section"

type EntryMode = "price" | "pips" | "usd"

const money = (n: number) => `${n < 0 ? "-" : "+"}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * One stop loss or take profit with three ways to enter it: an absolute price,
 * a distance in pips, or a dollar amount. The draft always stores the price;
 * pips and dollars are projections that write back through the conversion.
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
  commission?: number
  priceStep: number
  preview: number | null
}) {
  const [mode, setMode] = useState<EntryMode>("price")
  const isSL = kind === "sl"
  const label = isSL ? "Stop loss" : "Take profit"
  const sign = direction === "buy" ? 1 : -1
  const dirSign = isSL ? -sign : sign

  const pips = Math.abs(priceToPips(symbol, price - entryFill))
  const usd = Math.abs((price - entryFill) * sign * usdPerPriceUnit)
  const applyPips = (p: number) => onPrice(roundToDigits(symbol, entryFill + dirSign * pipsToPrice(symbol, Math.max(0, p))))
  const applyUsd = (u: number) => {
    if (usdPerPriceUnit <= 0) return
    onPrice(roundToDigits(symbol, entryFill + dirSign * (Math.max(0, u) / usdPerPriceUnit)))
  }

  const field = (value: number, onChange: (v: number) => void, step: number, suffix: string, aria: string) => (
    <div className="flex h-9 items-center rounded-lg border border-border bg-background pr-2.5 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
      <LocalNumberInput
        value={value}
        onChange={onChange}
        step={step}
        min={0}
        aria-label={aria}
        className="h-full flex-1 border-0 bg-transparent text-right font-mono text-[13px] font-semibold tabular-nums shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
      <span className="ml-1.5 w-7 text-[10.5px] font-semibold text-muted-foreground uppercase">{suffix}</span>
    </div>
  )

  return (
    <section className={cn("rounded-xl border p-2.5 transition-colors", enabled ? (isSL ? "border-loss/30 bg-loss/[0.04]" : "border-profit/30 bg-profit/[0.04]") : "border-border")}>
      <div className="flex items-center justify-between gap-2">
        <label className="flex cursor-pointer items-center gap-2">
          <Switch checked={enabled} onCheckedChange={(c) => onToggle(Boolean(c))} aria-label={label} className={cn(enabled && (isSL ? "data-[state=checked]:bg-loss" : "data-[state=checked]:bg-profit"))} />
          <span className={cn("text-[12px] font-semibold", enabled ? (isSL ? "text-loss" : "text-profit") : "text-muted-foreground")}>{label}</span>
        </label>
        {enabled ? (
          <Segmented
            label={`${label} entry`}
            value={mode}
            onChange={setMode}
            options={[
              { value: "price", label: "Price" },
              { value: "pips", label: "Pips" },
              { value: "usd", label: "$" },
            ]}
          />
        ) : null}
      </div>
      {enabled ? (
        <div className="mt-2 grid gap-1.5">
          {mode === "price"
            ? field(price, onPrice, priceStep, "", `${label} price`)
            : mode === "pips"
              ? field(Number(pips.toFixed(1)), applyPips, 1, "pips", `${label} distance in pips`)
              : field(Number(usd.toFixed(2)), applyUsd, 10, "usd", `${label} amount in dollars`)}
          {preview != null ? (
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">
                {pips.toFixed(1)} pips · {isSL ? "if hit" : "at target"}
              </span>
              <span className={cn("font-mono font-semibold tabular-nums", preview >= 0 ? "text-profit" : "text-loss")}>{money(preview)}</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

/** Reward to risk when both a stop and a target are set. */
export function RiskRewardLine({ slPreview, tpPreview }: { slPreview: number | null; tpPreview: number | null }) {
  if (slPreview == null || tpPreview == null) return null
  const risk = Math.abs(Math.min(slPreview, 0))
  const reward = Math.max(tpPreview, 0)
  if (risk <= 0) return null
  const rr = reward / risk
  const tone = rr >= 1.5 ? "text-profit" : rr >= 1 ? "text-warning" : "text-loss"
  return (
    <div className="flex items-center justify-between rounded-xl bg-secondary/60 px-3 py-2 text-[12px]">
      <span className="text-muted-foreground">Reward : risk</span>
      <span className={cn("font-mono font-semibold tabular-nums", tone)}>{rr.toFixed(2)} : 1</span>
    </div>
  )
}
