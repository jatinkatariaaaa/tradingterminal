import type { SupabaseClient } from "@supabase/supabase-js"
import type { ServerPosition, ServerOrder, ServerTrade } from "@/lib/trading/orders"

// snake_case row shapes returned by Supabase, mapped to the camelCase domain
// types in lib/trading/orders.ts. RLS scopes every query to the owner.

interface PositionRow {
  id: string; account_id: string; symbol: string; direction: "buy" | "sell"
  volume: number; open_price: number; contract_size: number; digits: number
  stop_loss: number | null; take_profit: number | null; commission: number
  swap: number; margin: number; open_time: string
}

function mapPosition(r: PositionRow): ServerPosition {
  return {
    id: r.id, accountId: r.account_id, symbol: r.symbol, direction: r.direction,
    volume: Number(r.volume), openPrice: Number(r.open_price),
    contractSize: Number(r.contract_size), digits: r.digits,
    stopLoss: r.stop_loss == null ? null : Number(r.stop_loss),
    takeProfit: r.take_profit == null ? null : Number(r.take_profit),
    commission: Number(r.commission), swap: Number(r.swap), margin: Number(r.margin),
    openTime: r.open_time,
  }
}

export async function fetchPositions(
  supabase: SupabaseClient,
  accountId: string,
): Promise<ServerPosition[]> {
  const { data, error } = await supabase
    .from("positions")
    .select(
      "id, account_id, symbol, direction, volume, open_price, contract_size, digits, stop_loss, take_profit, commission, swap, margin, open_time",
    )
    .eq("account_id", accountId)
    .order("open_time", { ascending: false })
  if (error) throw error
  return (data as PositionRow[]).map(mapPosition)
}

interface OrderRow {
  id: string; account_id: string; symbol: string; direction: "buy" | "sell"
  kind: "limit" | "stop"; status: "working" | "filled" | "cancelled"; volume: number
  trigger_price: number; placed_price: number; stop_loss: number | null
  take_profit: number | null; created_at: string; filled_at: string | null
  cancelled_at: string | null
}

function mapOrder(r: OrderRow): ServerOrder {
  return {
    id: r.id, accountId: r.account_id, symbol: r.symbol, direction: r.direction,
    kind: r.kind, status: r.status, volume: Number(r.volume),
    triggerPrice: Number(r.trigger_price), placedPrice: Number(r.placed_price),
    stopLoss: r.stop_loss == null ? null : Number(r.stop_loss),
    takeProfit: r.take_profit == null ? null : Number(r.take_profit),
    createdAt: r.created_at, filledAt: r.filled_at, cancelledAt: r.cancelled_at,
  }
}

export async function fetchWorkingOrders(
  supabase: SupabaseClient,
  accountId: string,
): Promise<ServerOrder[]> {
  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, account_id, symbol, direction, kind, status, volume, trigger_price, placed_price, stop_loss, take_profit, created_at, filled_at, cancelled_at",
    )
    .eq("account_id", accountId)
    .eq("status", "working")
    .order("created_at", { ascending: false })
  if (error) throw error
  return (data as OrderRow[]).map(mapOrder)
}

interface TradeRow {
  id: string; account_id: string; symbol: string; direction: "buy" | "sell"
  volume: number; open_price: number; close_price: number; open_time: string
  close_time: string; gross_pnl: number; commission: number; swap: number
  net_pnl: number; reason: "tp" | "sl" | "manual" | "breach"
}

function mapTrade(r: TradeRow): ServerTrade {
  return {
    id: r.id, accountId: r.account_id, symbol: r.symbol, direction: r.direction,
    volume: Number(r.volume), openPrice: Number(r.open_price), closePrice: Number(r.close_price),
    openTime: r.open_time, closeTime: r.close_time, grossPnl: Number(r.gross_pnl),
    commission: Number(r.commission), swap: Number(r.swap), netPnl: Number(r.net_pnl),
    reason: r.reason,
  }
}

export async function fetchTrades(
  supabase: SupabaseClient,
  accountId: string,
  limit = 100,
): Promise<ServerTrade[]> {
  const { data, error } = await supabase
    .from("trades")
    .select(
      "id, account_id, symbol, direction, volume, open_price, close_price, open_time, close_time, gross_pnl, commission, swap, net_pnl, reason",
    )
    .eq("account_id", accountId)
    .order("close_time", { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data as TradeRow[]).map(mapTrade)
}
