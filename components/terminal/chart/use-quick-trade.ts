"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "@/hooks/use-toast"
import { formatPrice, getAsset } from "@/lib/trading/assets"
import type { Direction } from "@/lib/trading/types"
import { useTradingActions, useTradingState } from "../trading-provider"

/**
 * One-click market execution. `executeOrder()` reads the draft from a ref that
 * only refreshes on re-render, so we stage the request, patch the draft, and
 * fire on the next render pass once the draft has actually propagated.
 */
export function useQuickTrade() {
  const { draft, activeSymbol, isSubmitting } = useTradingState()
  const { setDraft, executeOrder } = useTradingActions()
  const [pending, setPending] = useState<Direction | null>(null)
  const firingRef = useRef(false)

  const fire = useCallback(
    (direction: Direction) => {
      if (isSubmitting || firingRef.current) return
      setDraft({ direction, type: "market" })
      setPending(direction)
    },
    [isSubmitting, setDraft],
  )

  useEffect(() => {
    if (!pending || firingRef.current) return
    if (draft.direction !== pending || draft.type !== "market") return
    firingRef.current = true
    setPending(null)
    executeOrder()
      .then((result) => {
        if (!result) return
        if (result.ok) {
          const asset = getAsset(result.symbol)
          toast({
            title: `${result.direction === "buy" ? "Bought" : "Sold"} ${result.volume} ${result.symbol}`,
            description: `Filled at ${formatPrice(result.price, asset.digits)}`,
          })
        } else {
          toast({
            title: "Order rejected",
            description: result.reason,
            variant: "destructive",
          })
        }
      })
      .finally(() => {
        firingRef.current = false
      })
  }, [pending, draft.direction, draft.type, executeOrder])

  return { fire, isSubmitting, activeSymbol }
}
