// Service-role Supabase client + typed RPC wrappers around the SECURITY DEFINER
// functions in 0004_risk_engine.sql. The service-role key BYPASSES RLS, so this
// module must only ever run inside this trusted worker process.

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

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

export type Direction = "buy" | "sell"
export type CloseReason = "tp" | "sl" | "manual" | "breach"
export type AccountStatus = "active" | "passed" | "breached" | "funded"

export interface AccountRow {
  id: string
  status: AccountStatus
  phase: "challenge" | "funded"
  balance: number
  equity: number
  starting_balance: number
  daily_start_balance: number
  max_daily_drawdown: number
  max_overall_drawdown: number
  profit_target: number
  last_daily_reset_at: string | null
}

export interface PositionRow {
  id: string
  account_id: string
  symbol: string
  direction: Direction
  volume: number
  open_price: number
  contract_size: number
  digits: number
  stop_loss: number | null
  take_profit: number | null
  commission: number
  margin: number
}

export interface OrderRow {
  id: string
  account_id: string
  symbol: string
  direction: Direction
  kind: "limit" | "stop"
  volume: number
  trigger_price: number
  placed_price: number
  stop_loss: number | null
  take_profit: number | null
}

/** Accounts that can still trade (active or funded). */
export async function fetchTradableAccounts(): Promise<AccountRow[]> {
  const { data, error } = await supabase
    .from("accounts")
    .select(
      "id, status, phase, balance, equity, starting_balance, daily_start_balance, max_daily_drawdown, max_overall_drawdown, profit_target, last_daily_reset_at",
    )
    .in("status", ["active", "funded"])
  if (error) throw error
  return (data ?? []) as AccountRow[]
}

export async function fetchAccountSnapshot(accountId: string): Promise<AccountRow> {
  const { data, error } = await supabase
    .from("accounts")
    .select(
      "id, status, phase, balance, equity, starting_balance, daily_start_balance, max_daily_drawdown, max_overall_drawdown, profit_target, last_daily_reset_at",
    )
    .eq("id", accountId)
    .single()
  if (error) throw error
  return data as AccountRow
}

export async function fetchPositions(accountId: string): Promise<PositionRow[]> {
  const { data, error } = await supabase
    .from("positions")
    .select(
      "id, account_id, symbol, direction, volume, open_price, contract_size, digits, stop_loss, take_profit, commission, margin",
    )
    .eq("account_id", accountId)
  if (error) throw error
  return (data ?? []) as PositionRow[]
}

export async function fetchWorkingOrders(accountId: string): Promise<OrderRow[]> {
  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, account_id, symbol, direction, kind, volume, trigger_price, placed_price, stop_loss, take_profit",
    )
    .eq("account_id", accountId)
    .eq("status", "working")
  if (error) throw error
  return (data ?? []) as OrderRow[]
}

/** Bulk fetch all positions for a batch of accounts (O(1) query) */
export async function fetchAllPositions(accountIds: string[]): Promise<PositionRow[]> {
  if (accountIds.length === 0) return []
  const { data, error } = await supabase
    .from("positions")
    .select(
      "id, account_id, symbol, direction, volume, open_price, contract_size, digits, stop_loss, take_profit, commission, margin",
    )
    .in("account_id", accountIds)
  if (error) throw error
  return (data ?? []) as PositionRow[]
}

/** Bulk fetch all working orders for a batch of accounts (O(1) query) */
export async function fetchAllWorkingOrders(accountIds: string[]): Promise<OrderRow[]> {
  if (accountIds.length === 0) return []
  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, account_id, symbol, direction, kind, volume, trigger_price, placed_price, stop_loss, take_profit",
    )
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
  const { data, error } = await supabase.rpc("apply_risk_tick", {
    p_account_id: accountId,
    p_equity: equity,
  })
  if (error) throw error
  return data as AccountStatus
}

export async function rpcOpenPosition(args: {
  accountId: string
  symbol: string
  direction: Direction
  volume: number
  entryFill: number
  contractSize: number
  digits: number
  margin: number
  commission: number
  stopLoss: number | null
  takeProfit: number | null
}): Promise<void> {
  const { error } = await supabase.rpc("open_position", {
    p_account_id: args.accountId,
    p_symbol: args.symbol,
    p_direction: args.direction,
    p_volume: args.volume,
    p_entry_fill: args.entryFill,
    p_contract_size: args.contractSize,
    p_digits: args.digits,
    p_margin: args.margin,
    p_commission: args.commission,
    p_stop_loss: args.stopLoss,
    p_take_profit: args.takeProfit,
  })
  if (error) throw error
}

export async function rpcCancelOrder(orderId: string): Promise<void> {
  const { error } = await supabase.rpc("cancel_order", { p_order_id: orderId })
  if (error) throw error
}

/**
 * Atomically fill a working pending order exactly once. Returns true when a
 * position was opened, false when the RPC no-op'd (order already filled/
 * cancelled, account not tradable, or insufficient margin this tick).
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

export interface BreachMark {
  position_id: string
  exit_fill: number
  gross_pnl: number
  commission: number
}

/**
 * Atomically close every open position at the supplied close-side marks, freeze
 * the account, and write the audit event — all in one transaction.
 */
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

export async function rpcPassAccount(args: {
  accountId: string
  equity: number
  marks: BreachMark[]
}): Promise<AccountRow> {
  const { data, error } = await supabase.rpc("pass_account", {
    p_account_id: args.accountId,
    p_equity: args.equity,
    p_marks: args.marks,
  })
  if (error) throw error
  return data as AccountRow
}
