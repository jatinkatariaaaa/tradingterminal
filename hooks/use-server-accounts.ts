"use client"

import { useCallback, useEffect, useState } from "react"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"
import { fetchMyAccounts } from "@/lib/supabase/accounts"
import type { ServerAccount } from "@/lib/trading/account"

interface UseServerAccounts {
  accounts: ServerAccount[]
  loading: boolean
  /** Null until a load has been attempted; set when the user is signed out or a query fails. */
  error: string | null
  /** True once we know there is no authenticated session. */
  signedOut: boolean
  refresh: () => Promise<void>
}

/**
 * Read-only loader for the signed-in user's server-authoritative accounts.
 *
 * Step 1 deliberately does NOT touch the live risk math in TradingProvider — it
 * only surfaces what the server says, so the two can be compared before any
 * client logic is removed. Reconnects on auth state changes so a sign-in /
 * sign-out is reflected without a manual refresh.
 */
export function useServerAccounts(): UseServerAccounts {
  const [accounts, setAccounts] = useState<ServerAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [signedOut, setSignedOut] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const supabase = createSupabaseBrowserClient()
      const { data: { user } } = await supabase.auth.getUser()
      console.log("[useServerAccounts] supabase.auth.getUser() result:", user ? `User ${user.id} logged in` : "No user logged in")
      if (!user) {
        setSignedOut(true)
        setAccounts([])
        return
      }
      setSignedOut(false)
      
      let list = await fetchMyAccounts(supabase)
      console.log("[useServerAccounts] fetchMyAccounts returned:", list.length, "accounts")
      if (list.length === 0) {
        console.log("[useServerAccounts] No accounts found. Auto-creating default $100k account...")
        const res = await fetch("/api/trade/create-account", { method: "POST" })
        console.log("[useServerAccounts] Auto-create response status:", res.status)
        if (res.ok) {
          list = await fetchMyAccounts(supabase)
          console.log("[useServerAccounts] fetchMyAccounts after auto-create returned:", list.length, "accounts")
        } else {
          const errData = await res.json()
          console.error("[useServerAccounts] Auto-creation failed:", errData.error)
        }
      }
      setAccounts(list)
    } catch (e: any) {
      console.error("[useServerAccounts] Error in load callback:", e?.message || e?.details || e)
      setError(e?.message || "Failed to load accounts")
      setAccounts([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    void load()
    // Refresh whenever auth state changes (sign-in/out/token refresh).
    let unsub: (() => void) | undefined
    try {
      const supabase = createSupabaseBrowserClient()
      const { data } = supabase.auth.onAuthStateChange(() => {
        if (active) void load()
      })
      unsub = () => data.subscription.unsubscribe()
    } catch {
      // Env not configured yet — leave the error from load() in place.
    }
    return () => {
      active = false
      unsub?.()
    }
  }, [load])

  return { accounts, loading, error, signedOut, refresh: load }
}
