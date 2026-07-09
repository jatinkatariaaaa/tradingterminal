"use client"

import { cn } from "@/lib/utils"
import { formatPrice } from "@/lib/trading/assets"

/**
 * cTrader-style outlined SELL/BUY price button with the last digit rendered
 * as a superscript pip digit (e.g. 1.0660⁵).
 */
export function QuoteButton({
  side,
  price,
  digits,
  onClick,
  flash,
  className,
}: {
  side: "sell" | "buy"
  price: number
  digits: number
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
  flash?: "up" | "down" | null
  className?: string
}) {
  const text = formatPrice(price, digits)
  // Superscript the final digit only when there are decimals to split.
  const main = digits > 0 ? text.slice(0, -1) : text
  const pip = digits > 0 ? text.slice(-1) : ""

  const isSell = side === "sell"

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${isSell ? "Sell" : "Buy"} at ${text}`}
      className={cn(
        "press-scale flex min-w-[86px] flex-col items-center rounded-lg border px-2 py-1 transition-colors",
        isSell
          ? "border-sell/55 text-sell hover:bg-sell hover:text-sell-foreground"
          : "border-buy/55 text-buy hover:bg-buy hover:text-buy-foreground",
        flash === "up" && "flash-up",
        flash === "down" && "flash-down",
        className,
      )}
    >
      <span className="text-[10px] font-bold uppercase tracking-wide">{isSell ? "Sell" : "Buy"}</span>
      <span className="font-mono text-[13px] font-semibold leading-tight tabular-nums">
        {main}
        {pip && <sup className="text-[9px] font-bold">{pip}</sup>}
      </span>
    </button>
  )
}
