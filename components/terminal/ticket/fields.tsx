"use client"

import { useEffect, useRef, useState } from "react"
import { AlertTriangle, CheckCircle2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatPrice } from "@/lib/trading/assets"
import type { ExecutionFill } from "../trading-provider"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

/**
 * Number input that keeps a local string state so the user can clear/type
 * freely, syncing outward only on valid values and clamping on blur.
 */
export function LocalNumberInput({
  value,
  onChange,
  onBlurClamp,
  step,
  min,
  className,
  placeholder,
  "aria-label": ariaLabel,
}: {
  value: number
  onChange: (v: number) => void
  onBlurClamp?: number
  step?: number
  min?: number
  className?: string
  placeholder?: string
  "aria-label"?: string
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
      aria-label={ariaLabel}
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

/** Labelled price input row used for trigger/SL/TP prices. */
export function PriceField({
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
      <Label className="text-xs text-muted-foreground" style={accent ? { color: accent } : undefined}>
        {label}
      </Label>
      <LocalNumberInput
        value={value}
        onChange={onChange}
        step={step}
        aria-label={label}
        className="h-8 w-32 bg-secondary text-right font-mono text-sm tabular-nums"
      />
    </div>
  )
}

/** Confirmation + rejection banners shared by all order-entry surfaces. */
export function ExecutionBanners({
  confirm,
  rejection,
  digits,
  compact = false,
}: {
  confirm: ExecutionFill | null
  rejection: string | null
  digits: number
  compact?: boolean
}) {
  return (
    <>
      {confirm && (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            "flex animate-in items-center gap-2 rounded-lg border px-3 py-2 font-medium fade-in",
            compact ? "text-[10px]" : "text-xs",
            confirm.direction === "buy"
              ? "border-[var(--buy)]/40 bg-[var(--buy)]/10 text-[var(--buy)]"
              : "border-[var(--sell)]/40 bg-[var(--sell)]/10 text-[var(--sell)]",
          )}
        >
          <CheckCircle2 className={compact ? "h-3 w-3 shrink-0" : "h-4 w-4 shrink-0"} />
          <span>
            {confirm.kind === "pending" ? "Order placed" : "Executed"}:{" "}
            {confirm.direction === "buy" ? "Buy" : "Sell"} {confirm.volume} {confirm.symbol} @{" "}
            {formatPrice(confirm.price, digits)}
          </span>
        </div>
      )}
      {rejection && (
        <div
          role="alert"
          aria-live="assertive"
          className={cn(
            "flex animate-in items-start gap-2 rounded-lg border border-[var(--loss)]/40 bg-[var(--loss)]/10 px-3 py-2 font-medium text-[var(--loss)] fade-in",
            compact ? "text-[10px]" : "text-xs",
          )}
        >
          <AlertTriangle className={compact ? "h-3 w-3 shrink-0" : "mt-0.5 h-4 w-4 shrink-0"} />
          <span>{rejection}</span>
        </div>
      )}
    </>
  )
}
