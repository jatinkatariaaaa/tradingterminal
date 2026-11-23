"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"
import { fetchPositions, fetchWorkingOrders, fetchTrades } from "@/lib/supabase/positions"
import type { ServerPosition, ServerOrder, ServerTrade } from "@/lib/trading/orders"

type Portfolio = {
  positions: ServerPosition[]
  orders: ServerOrder[]
  trades: ServerTrade[]
}

const empty: Portfolio = { positions: [], orders: [], trades: [] }
const fetchers = { positions: fetchPositions, orders: fetchWorkingOrders, trades: fetchTrades }

export function useServerPortfolio(accountId: string | null) {
  const scope = useMemo(() => ({
    accountId,
    active: false,
    version: { positions: 0, orders: 0, trades: 0 },
  }), [accountId])
  const [snapshot, setSnapshot] = useState<{ scope: typeof scope; data: Portfolio }>()
  const patch = useCallback(<K extends keyof Portfolio>(key: K, update: (rows: Portfolio[K]) => Portfolio[K]) => {
    if (!scope.active) return
    setSnapshot((prev) => {
      if (!scope.active) return prev
      const data = prev?.scope === scope ? prev.data : empty
      return { scope, data: { ...data, [key]: update(data[key]) } }
    })
  }, [scope])

  const load = useCallback(async <K extends keyof Portfolio>(key: K) => {
    if (!scope.active || !scope.accountId) return
    const version = ++scope.version[key]
    try {
      const rows = await fetchers[key](createSupabaseBrowserClient(), scope.accountId) as Portfolio[K]
      if (scope.version[key] === version) patch(key, () => rows)
    } catch {
      // Keep the last confirmed data. A failed history request can't block open positions.
    }
  }, [patch, scope])

  const refresh = useCallback(async () => {
    await Promise.all([load("positions"), load("orders"), load("trades")])
  }, [load])

  const removePosition = useCallback((id: string) => {
    ++scope.version.positions
    patch("positions", (rows) => rows.filter((row) => row.id !== id))
  }, [patch, scope])

  const acceptPosition = useCallback((row: ServerPosition) => {
    if (row.accountId !== scope.accountId) return
    ++scope.version.positions
    patch("positions", (rows) => [row, ...rows.filter((old) => old.id !== row.id)])
  }, [patch, scope])

  const acceptOrder = useCallback((row: ServerOrder) => {
    if (row.accountId !== scope.accountId) return
    ++scope.version.orders
    patch("orders", (rows) => [row, ...rows.filter((old) => old.id !== row.id)])
  }, [patch, scope])

  useEffect(() => {
    if (!accountId) return
    scope.active = true
    void refresh()
    const supabase = createSupabaseBrowserClient()
    const filter = `account_id=eq.${accountId}`
    const channel = supabase.channel(`portfolio:${accountId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "positions", filter }, () => void load("positions"))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "positions", filter }, () => void load("positions"))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "orders", filter }, () => void load("orders"))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders", filter }, () => {
        void load("orders")
        void load("positions")
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "trades", filter }, () => void refresh())
      .subscribe((status) => { if (status === "SUBSCRIBED") void refresh() })

    // Reconcile worker closes even on projects without Realtime publications.
    // Scroll/chart activity doesn't affect the cadence, and hidden tabs make no polling requests.
    let polling = false
    let ticks = 0
    const timer = window.setInterval(async () => {
      if (document.hidden || polling) return
      polling = true
      try {
        if (++ticks % 4 === 0) await refresh()
        else await Promise.all([load("positions"), load("orders")])
      } finally {
        polling = false
      }
    }, 6000)
    const resume = () => { if (!document.hidden) void refresh() }
    document.addEventListener("visibilitychange", resume)
    window.addEventListener("online", resume)

    return () => {
      scope.active = false
      for (const key of ["positions", "orders", "trades"] as const) ++scope.version[key]
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", resume)
      window.removeEventListener("online", resume)
      void supabase.removeChannel(channel)
    }
  }, [accountId, load, refresh, scope])

  return { ...(snapshot?.scope === scope ? snapshot.data : empty), refresh, removePosition, acceptPosition, acceptOrder }
}
