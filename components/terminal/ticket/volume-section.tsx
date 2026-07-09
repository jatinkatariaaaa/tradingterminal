"use client"

import { AlertTriangle, Minus, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { LocalNumberInput } from "./fields"

const RISK_PRESETS = [0.5, 1, 2]

/**
 * Volume block with two sizing modes:
 *  - Lots: direct volume entry with +/- steppers
 *  - Risk %: position size computed from account balance, risk percentage and
 *    the SL distance (requires SL enabled).
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
}) {
  const adjustVolume = (delta: number) => {
    onVolume(Math.max(lotStep, Number((volume + delta).toFixed(2))))
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">Volume</Label>
        <div className="flex rounded-md bg-secondary p-0.5" role="tablist" aria-label="Sizing mode">
          <button
            type="button"
            role="tab"
            aria-selected={!autoRisk}
            onClick={() => onAutoRisk(false)}
            className={cn(
              "rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
              !autoRisk ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            Lots
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={autoRisk}
            onClick={() => onAutoRisk(true)}
            className={cn(
              "rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
              autoRisk ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            Risk %
          </button>
        </div>
      </div>

      {!autoRisk ? (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="icon"
            aria-label="Decrease volume"
            className="h-9 w-9 shrink-0"
            onClick={() => adjustVolume(-lotStep * 10)}
          >
            <Minus className="h-4 w-4" />
          </Button>
          <LocalNumberInput
            step={lotStep}
            min={lotStep}
            value={volume}
            onChange={onVolume}
            onBlurClamp={lotStep}
            aria-label="Volume in lots"
            className="h-9 bg-secondary text-center font-mono text-sm tabular-nums"
          />
          <Button
            type="button"
            variant="secondary"
            size="icon"
            aria-label="Increase volume"
            className="h-9 w-9 shrink-0"
            onClick={() => adjustVolume(lotStep * 10)}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            {RISK_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => onRiskPct(p)}
                className={cn(
                  "flex-1 rounded-md py-1.5 text-xs font-medium transition-colors",
                  riskPct === p
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-muted-foreground hover:text-foreground",
                )}
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
              className="h-8 w-16 bg-secondary text-center font-mono text-xs tabular-nums"
            />
          </div>
          {!slEnabled ? (
            <p className="flex items-center gap-1 text-[11px] text-[var(--warning)]">
              <AlertTriangle className="h-3 w-3" /> Enable Stop Loss to size by risk.
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Size: <span className="font-mono text-foreground">{volume}</span> lots
            </p>
          )}
        </div>
      )}

      {!autoRisk && roundedVolume !== volume && (
        <p className="text-[11px] text-muted-foreground">
          Rounded to {roundedVolume} lots (step {lotStep}).
        </p>
      )}
    </div>
  )
}
