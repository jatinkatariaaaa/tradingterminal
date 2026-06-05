"use client"

import { useCallback, useEffect, useState } from "react"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"
import { fetchPositions, fetchWorkingOrders, fetchTrades } from "@/lib/supabase/positions"
import type { ServerPosition, ServerOrder, ServerTrade } from "@/lib/trading/orders"

interface ServerPortfolio {
  positions: ServerPosition[]
  orders: ServerOrder[]
  trades: ServerTrade[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

/**
 * READ-ONLY live portfolio for a single account, kept in sync with the server
 * via Supabase Realtime. Step 3b only — this does NOT replace TradingProvider; it
 * is a parallel read path the Step 3c cutover will build on. Any change the
 * worker or the /api/trade routes make to positions/orders/trades is reflected
 * here within the Realtime latency, no polling required.
 */
export function useServerPortfolio(accountId: string | null): ServerPortfolio {
  const [positions, setPositions] = useState<ServerPosition[]>([])
  const [orders, setOrders] = useState<ServerOrder[]>([])
  const [trades, setTrades] = useState<ServerTrade[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!accountId) {
      setPositions([]); setOrders([]); setTrades([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const supabase = createSupabaseBrowserClient()
      const [p, o, t] = await Promise.all([
        fetchPositions(supabase, accountId),
        fetchWorkingOrders(supabase, accountId),
        fetchTrades(supabase, accountId),
      ])
      setPositions(p); setOrders(o); setTrades(t)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load portfolio")
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => {
    if (!accountId) return
    void load()

    const supabase = createSupabaseBrowserClient()
    // One channel for all three tables, filtered to this account. On any change
    // we reload the affected slice; the payloads are small so a targeted refetch
    // keeps the mapping logic in one place (lib/supabase/positions.ts).
    const channel = supabase
      .channel(`portfolio:${accountId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "positions", filter: `account_id=eq.${accountId}` },
        () => void fetchPositions(supabase, accountId).then(setPositions).catch(() => {}),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders", filter: `account_id=eq.${accountId}` },
        () => void fetchWorkingOrders(supabase, accountId).then(setOrders).catch(() => {}),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "trades", filter: `account_id=eq.${accountId}` },
        () => void fetchTrades(supabase, accountId).then(setTrades).catch(() => {}),
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [accountId, load])

  return { positions, orders, trades, loading, error, refresh: load }
}
