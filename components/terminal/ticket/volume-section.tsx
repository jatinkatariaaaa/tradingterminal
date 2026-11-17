"use client"

import type { ReactNode } from "react"
import { AlertTriangle, Minus, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import { LocalNumberInput } from "./fields"

const RISK_PRESETS = [0.25, 0.5, 1, 2]
const LOT_CHIPS = [0.01, 0.1, 0.5, 1, 2, 5]

/** Two-option segmented control used across the ticket. */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="flex rounded-lg bg-secondary p-0.5" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn("h-6 rounded-md px-2 text-[11px] font-semibold transition-colors", value === o.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Volume with two sizing modes:
 *  - Lots: a stepper plus one-tap sizes
 *  - Risk %: the size follows from the balance, the risk and the stop distance (needs a stop loss)
 */
export function VolumeSection({
  volume,
  lotStep,
  onVolume,
  autoRisk,
  onAutoRisk,
  riskPct,
  onRiskPct,
  slEnabled,
  roundedVolume,
  footnote,
}: {
  volume: number
  lotStep: number
  onVolume: (v: number) => void
  autoRisk: boolean
  onAutoRisk: (on: boolean) => void
  riskPct: number
  onRiskPct: (pct: number) => void
  slEnabled: boolean
  roundedVolume: number
  footnote?: ReactNode
}) {
  const adjust = (delta: number) => onVolume(Math.max(lotStep, Number((volume + delta).toFixed(2))))

  return (
    <section className="grid gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold">Volume</span>
        <Segmented
          label="Sizing mode"
          value={autoRisk ? "risk" : "lots"}
          onChange={(v) => onAutoRisk(v === "risk")}
          options={[
            { value: "lots", label: "Lots" },
            { value: "risk", label: "Risk %" },
          ]}
        />
      </div>

      {!autoRisk ? (
        <>
          <div className="flex h-10 items-stretch overflow-hidden rounded-xl border border-border bg-background focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
            <button type="button" aria-label="Decrease volume" onClick={() => adjust(-lotStep * 10)} className="grid w-10 place-items-center border-r border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
              <Minus className="h-4 w-4" />
            </button>
            <LocalNumberInput
              step={lotStep}
              min={lotStep}
              value={volume}
              onChange={onVolume}
              onBlurClamp={lotStep}
              aria-label="Volume in lots"
              className="h-full flex-1 rounded-none border-0 bg-transparent text-center font-mono text-[15px] font-semibold tabular-nums shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
            <span className="flex items-center pr-2 text-[11px] text-muted-foreground">lots</span>
            <button type="button" aria-label="Increase volume" onClick={() => adjust(lotStep * 10)} className="grid w-10 place-items-center border-l border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
              <Plus className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-6 gap-1">
            {LOT_CHIPS.filter((v) => v >= lotStep).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => onVolume(v)}
                className={cn("h-7 rounded-lg font-mono text-[11.5px] font-semibold tabular-nums transition-colors", volume === v ? "bg-foreground text-background" : "bg-secondary text-muted-foreground hover:text-foreground")}
              >
                {v}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-[repeat(4,1fr)_72px] gap-1">
            {RISK_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => onRiskPct(p)}
                className={cn("h-9 rounded-lg text-[12px] font-semibold tabular-nums transition-colors", riskPct === p ? "bg-foreground text-background" : "bg-secondary text-muted-foreground hover:text-foreground")}
              >
                {p}%
              </button>
            ))}
            <LocalNumberInput
              step={0.1}
              min={0.1}
              value={riskPct}
              onChange={onRiskPct}
              onBlurClamp={0.1}
              aria-label="Risk percentage"
              className="h-9 rounded-lg bg-background text-center font-mono text-[12.5px] tabular-nums"
            />
          </div>
          {!slEnabled ? (
            <p className="flex items-center gap-1.5 text-[11.5px] text-warning">
              <AlertTriangle className="h-3.5 w-3.5" /> Turn on a stop loss to size by risk.
            </p>
          ) : (
            <p className="text-[11.5px] text-muted-foreground">
              Sized at <span className="font-mono font-semibold text-foreground">{volume}</span> lots for {riskPct}% of the balance.
            </p>
          )}
        </>
      )}

      {!autoRisk && roundedVolume !== volume ? <p className="text-[11px] text-muted-foreground">Rounded to {roundedVolume} lots (step {lotStep}).</p> : null}
      {footnote}
    </section>
  )
}
