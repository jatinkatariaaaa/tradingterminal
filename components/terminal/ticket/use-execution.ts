"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { playExecutionSound } from "@/lib/trading/sound"
import { useTrading, type ExecutionFill } from "../trading-provider"

/**
 * Shared execution state machine used by every order-entry surface (desktop
 * ticket, mobile panel, one-click strip). Handles double-tap guarding,
 * confirmation + rejection banners with auto-dismiss, and execution sound.
 */
export function useExecution() {
  const { executeOrder } = useTrading()
  const [confirm, setConfirm] = useState<ExecutionFill | null>(null)
  const [rejection, setRejection] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    return () => timers.current.forEach(clearTimeout)
  }, [])

  const execute = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      const result = await executeOrder()
      if (!result) {
        setBusy(false)
        return
      }
      if (!result.ok) {
        setConfirm(null)
        setRejection(result.reason)
        timers.current.push(setTimeout(() => setRejection(null), 3600))
        setBusy(false)
        return
      }
      setRejection(null)
      setConfirm(result)
      playExecutionSound(result.direction)
      // Cooldown so an accidental second tap can't fire another order before
      // the trader sees the confirmation.
      timers.current.push(setTimeout(() => setBusy(false), 900))
      timers.current.push(setTimeout(() => setConfirm(null), 2600))
    } catch {
      setBusy(false)
      setRejection("An unexpected error occurred.")
      timers.current.push(setTimeout(() => setRejection(null), 3600))
    }
  }, [busy, executeOrder])

  return { execute, busy, confirm, rejection }
}
