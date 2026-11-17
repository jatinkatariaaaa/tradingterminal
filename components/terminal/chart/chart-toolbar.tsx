"use client"

import { CandlestickChart, ChartLine, ChartArea, SlidersHorizontal, Check } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { INDICATOR_LABELS, type IndicatorId } from "./indicators"

export type ChartStyle = "candles" | "line" | "area"

const STYLES: { id: ChartStyle; label: string; icon: typeof CandlestickChart }[] = [
  { id: "candles", label: "Candles", icon: CandlestickChart },
  { id: "line", label: "Line", icon: ChartLine },
  { id: "area", label: "Area", icon: ChartArea },
]

const ALL_INDICATORS = Object.keys(INDICATOR_LABELS) as IndicatorId[]

export function ChartToolbar({
  style,
  onStyleChange,
  indicators,
  onToggleIndicator,
}: {
  style: ChartStyle
  onStyleChange: (s: ChartStyle) => void
  indicators: IndicatorId[]
  onToggleIndicator: (id: IndicatorId) => void
}) {
  return (
    <div className="flex items-center gap-1">
      {/* Chart style switcher */}
      <div className="flex items-center gap-0.5 rounded-lg bg-secondary p-0.5">
        {STYLES.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onStyleChange(id)}
            aria-pressed={style === id}
            aria-label={`${label} chart`}
            title={label}
            className={cn(
              "grid h-6 w-7 place-items-center rounded-md transition-colors",
              style === id
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        ))}
      </div>

      {/* Indicators menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[11.5px] font-semibold transition-colors",
              indicators.length > 0
                ? "border-volt/60 bg-volt/10 text-foreground"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
            aria-label="Indicators"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Indicators</span>
            {indicators.length > 0 && <span className="tabular-nums">{indicators.length}</span>}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel className="text-xs">Indicators</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {ALL_INDICATORS.map((id) => {
            const active = indicators.includes(id)
            return (
              <DropdownMenuItem
                key={id}
                onSelect={(e) => {
                  e.preventDefault() // keep the menu open for multi-toggle
                  onToggleIndicator(id)
                }}
                className="flex items-center justify-between text-xs"
              >
                {INDICATOR_LABELS[id]}
                {active && <Check className="h-3.5 w-3.5" />}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
