// Server-authoritative position / order / trade models (Phase 3, Step 2).
// Mirror the positions, orders, and trades rows in Supabase. Written ONLY by
// trusted server code; the client treats them as read-only.

import type { Direction } from "./types"

/** An open position (mirrors public.positions). */
export interface ServerPosition {
  id: string
  accountId: string
  symbol: string
  direction: Direction
  volume: number
  openPrice: number
  contractSize: number
  digits: number
  stopLoss: number | null
  takeProfit: number | null
  commission: number
  swap: number
  margin: number
  openTime: string
}

export type ServerOrderKind = "limit" | "stop"
export type ServerOrderStatus = "working" | "filled" | "cancelled"

/** A pending order (mirrors public.orders). */
export interface ServerOrder {
  id: string
  accountId: string
  symbol: string
  direction: Direction
  kind: ServerOrderKind
  status: ServerOrderStatus
  volume: number
  triggerPrice: number
  placedPrice: number
  stopLoss: number | null
  takeProfit: number | null
  createdAt: string
  filledAt: string | null
  cancelledAt: string | null
}

export type ServerCloseReason = "tp" | "sl" | "manual" | "breach"

/** A closed trade in the immutable ledger (mirrors public.trades). */
export interface ServerTrade {
  id: string
  accountId: string
  symbol: string
  direction: Direction
  volume: number
  openPrice: number
  closePrice: number
  openTime: string
  closeTime: string
  grossPnl: number
  commission: number
  swap: number
  netPnl: number
  reason: ServerCloseReason
}
