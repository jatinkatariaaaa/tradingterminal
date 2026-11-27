// Service-role Supabase client and the database calls the risk engines make. The service-role key
// BYPASSES RLS, so this module must only ever run inside this trusted worker process.

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import type {
  AccountRow, AccountStatus, BreachMark, CloseReason, CycleResult, CycleTick, Fingerprints, OrderRow, PositionRow,
  PriceRow, RiskDb,
} from "./types.js"

export type { AccountRow, AccountStatus, BreachMark, CloseReason, Direction, OrderRow, PositionRow } from "./types.js"

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var ${name}`)
  return v
}

export const supabase: SupabaseClient = createClient(
  required("SUPABASE_URL"),
  required("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { autoRefreshToken: false, persistSession: false } },
)

const ACCOUNT_COLUMNS =
  "id, status, phase, balance, equity, starting_balance, daily_start_balance, max_daily_drawdown, max_overall_drawdown, profit_target, last_daily_reset_at, leverage"
const POSITION_COLUMNS =
  "id, account_id, symbol, direction, volume, open_price, contract_size, digits, stop_loss, take_profit, commission, margin"
const ORDER_COLUMNS =
  "id, account_id, symbol, direction, kind, volume, trigger_price, placed_price, stop_loss, take_profit"

/** Accounts that can still trade (active or funded). */
export async function fetchTradableAccounts(): Promise<AccountRow[]> {
  const { data, error } = await supabase.from("accounts").select(ACCOUNT_COLUMNS).in("status", ["active", "funded"])
  if (error) throw error
  return (data ?? []) as AccountRow[]
}

export async function fetchAccountSnapshot(accountId: string): Promise<AccountRow> {
  const { data, error } = await supabase.from("accounts").select(ACCOUNT_COLUMNS).eq("id", accountId).single()
  if (error) throw error
  return data as AccountRow
}

/** Bulk fetch all positions for a batch of accounts (one query). */
export async function fetchAllPositions(accountIds: string[]): Promise<PositionRow[]> {
  if (accountIds.length === 0) return []
  const { data, error } = await supabase.from("positions").select(POSITION_COLUMNS).in("account_id", accountIds)
  if (error) throw error
  return (data ?? []) as PositionRow[]
}

/** Bulk fetch all working orders for a batch of accounts (one query). */
export async function fetchAllWorkingOrders(accountIds: string[]): Promise<OrderRow[]> {
  if (accountIds.length === 0) return []
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_COLUMNS)
    .in("account_id", accountIds)
    .eq("status", "working")
  if (error) throw error
  return (data ?? []) as OrderRow[]
}

export async function rpcClosePosition(args: {
  positionId: string
  exitFill: number
  grossPnl: number
  commission: number
  reason: CloseReason
}): Promise<void> {
  const { error } = await supabase.rpc("close_position", {
    p_position_id: args.positionId,
    p_exit_fill: args.exitFill,
    p_gross_pnl: args.grossPnl,
    p_commission: args.commission,
    p_reason: args.reason,
  })
  if (error) throw error
}

export async function rpcApplyRiskTick(accountId: string, equity: number): Promise<AccountStatus> {
  const { data, error } = await supabase.rpc("apply_risk_tick", { p_account_id: accountId, p_equity: equity })
  if (error) throw error
  return data as AccountStatus
}

/**
 * Atomically fill a working pending order exactly once. Returns true when a position was opened, false
 * when the RPC no-op'd (order already filled/cancelled, account not tradable, or not enough margin yet).
 */
export async function rpcFillOrder(args: {
  orderId: string
  entryFill: number
  contractSize: number
  digits: number
  margin: number
  commission: number
}): Promise<boolean> {
  const { data, error } = await supabase.rpc("fill_order", {
    p_order_id: args.orderId,
    p_entry_fill: args.entryFill,
    p_contract_size: args.contractSize,
    p_digits: args.digits,
    p_margin: args.margin,
    p_commission: args.commission,
  })
  if (error) throw error
  return data != null
}

/** Atomically close every open position at the supplied marks, freeze the account and audit it. */
export async function rpcBreachAccount(args: {
  accountId: string
  equity: number
  kind: "daily_breach" | "overall_breach"
  reason: string
  marks: BreachMark[]
}): Promise<void> {
  const { error } = await supabase.rpc("breach_account", {
    p_account_id: args.accountId,
    p_equity: args.equity,
    p_kind: args.kind,
    p_reason: args.reason,
    p_marks: args.marks,
  })
  if (error) throw error
}

export async function rpcPassAccount(args: { accountId: string; equity: number; marks: BreachMark[] }): Promise<AccountRow> {
  const { data, error } = await supabase.rpc("pass_account", {
    p_account_id: args.accountId,
    p_equity: args.equity,
    p_marks: args.marks,
  })
  if (error) throw error
  return data as AccountRow
}

export async function upsertPrices(rows: PriceRow[]): Promise<void> {
  const { error } = await supabase.from("prices").upsert(rows, { onConflict: "symbol" })
  if (error) throw error
}

/** Engine v4: one loop's equity updates and prices in one request; returns the changed snapshot parts. */
export async function rpcRiskCycle(ticks: CycleTick[], prices: PriceRow[], known: Fingerprints): Promise<CycleResult> {
  const { data, error } = await supabase.rpc("risk_cycle", { p_ticks: ticks, p_prices: prices, p_known: known })
  if (error) throw error
  return data as CycleResult
}

export const liveDb: RiskDb = {
  fetchTradableAccounts,
  fetchAllPositions,
  fetchAllWorkingOrders,
  fetchAccountSnapshot,
  applyRiskTick: rpcApplyRiskTick,
  closePosition: rpcClosePosition,
  fillOrder: rpcFillOrder,
  breachAccount: rpcBreachAccount,
  passAccount: rpcPassAccount,
  upsertPrices,
  riskCycle: rpcRiskCycle,
}
