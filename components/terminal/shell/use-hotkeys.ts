"use client"

import { useEffect } from "react"
import { useTrading } from "../trading-provider"

/**
 * Global keyboard shortcuts for the desktop terminal:
 *  - B — set order direction to Buy
 *  - S — set order direction to Sell
 *  - Esc — exit manage mode / deselect position
 *  - Shift+X — close all open positions (with native confirm guard)
 *
 * Shortcuts are suppressed while typing in inputs/textareas/contenteditable
 * or when a dialog is open, so they never fire mid-form.
 */
export function useHotkeys() {
  const { setDraft, endManage, setSelectedPositionId, closeAllPositions, openPositions } =
    useTrading()

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Never hijack typing or IME composition.
      if (e.isComposing) return
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return
      }
      // Skip when a modal/dialog is open (it owns the keyboard).
      if (document.querySelector('[role="dialog"][data-state="open"]')) return
      // Skip combos owned by the browser or the command palette.
      if (e.metaKey || e.ctrlKey || e.altKey) return

      switch (e.key) {
        case "b":
        case "B":
          if (e.shiftKey) return
          e.preventDefault()
          setDraft({ direction: "buy" })
          break
        case "s":
        case "S":
          if (e.shiftKey) return
          e.preventDefault()
          setDraft({ direction: "sell" })
          break
        case "Escape":
          endManage()
          setSelectedPositionId(null)
          break
        case "X":
          if (!e.shiftKey) return
          if (openPositions.length === 0) return
          e.preventDefault()
          if (window.confirm(`Close all ${openPositions.length} open position(s) at market?`)) {
            closeAllPositions()
          }
          break
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [setDraft, endManage, setSelectedPositionId, closeAllPositions, openPositions.length])
}
