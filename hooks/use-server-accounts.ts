"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"
import { fetchMyAccounts } from "@/lib/supabase/accounts"
import type { ServerAccount } from "@/lib/trading/account"

export function useServerAccounts() {
  const [accounts, setAccounts] = useState<ServerAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [signedOut, setSignedOut] = useState(false)
  const sequence = useRef(0)

  const load = useCallback(async () => {
    const request = ++sequence.current
    setError(null)
    try {
      const supabase = createSupabaseBrowserClient()
      // RLS authorizes the account read. Session presence is only a UI hint.
      const { data: { session }, error: sessionError } = await supabase.auth.getSession()
      if (sessionError) throw sessionError
      const list = session ? await fetchMyAccounts(supabase) : []
      if (sequence.current !== request) return
      setSignedOut(!session)
      setAccounts(list)
    } catch (cause) {
      if (sequence.current === request) {
        setError(cause instanceof Error ? cause.message : "Failed to load accounts")
      }
    } finally {
      if (sequence.current === request) setLoading(false)
    }
  }, [])

  useEffect(() => {
    let timer: number | undefined
    const { data } = createSupabaseBrowserClient().auth.onAuthStateChange((event, session) => {
      if (event === "TOKEN_REFRESHED") return
      window.clearTimeout(timer)
      ++sequence.current
      if (!session) {
        setAccounts([])
        setSignedOut(true)
        setLoading(false)
        return
      }
      setSignedOut(false)
      // Let Supabase finish its auth callback before making any Supabase request.
      timer = window.setTimeout(() => void load(), 0)
    })
    return () => {
      window.clearTimeout(timer)
      data.subscription.unsubscribe()
      ++sequence.current
    }
  }, [load])

  return { accounts, loading, error, signedOut, refresh: load }
}
