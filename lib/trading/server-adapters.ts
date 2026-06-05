// Phase 3, Step 3c: Server → Client type adapters.
//
// During the TradingProvider cutover we swap the data source from local useState
// to useServerPortfolio (Realtime). These adapters convert the server-authoritative
// types (written by SQL/worker) into the existing client types (consumed by 8+ UI
// components) so no downstream component needs changes until we're ready.
//
// Once the cutover is complete and stable, a future cleanup pass can migrate the
// UI components to read the server types directly and delete this file.

import type { ServerPosition, ServerOrder, ServerTrade } from "./orders"
import type { ServerAccount } from "./account"
import type { OpenPosition, ClosedTrade, AccountState } from "./types"
import type { PendingOrder } from "@/components/terminal/trading-provider"
import { getAsset } from "./assets"

/**
 * ServerPosition → OpenPosition.
 *
 * Field mapping:
 *  - openPrice  → entryPrice
 *  - openTime   → openedAt (ISO string → epoch ms)
 */
export function toOpenPosition(sp: ServerPosition): OpenPosition {
  return {
    id: sp.id,
    symbol: sp.symbol,
    direction: sp.direction,
    volume: sp.volume,
    entryPrice: sp.openPrice,
    contractSize: sp.contractSize,
    digits: sp.digits,
    stopLoss: sp.stopLoss,
    takeProfit: sp.takeProfit,
    openedAt: new Date(sp.openTime).getTime(),
    margin: sp.margin,
  }
}

/**
 * ServerOrder (working) → PendingOrder.
 *
 * Field mapping:
 *  - kind        → type
 *  - triggerPrice → triggerPrice (same)
 *  - placedPrice  → placedPrice (same)
 *  - createdAt    → createdAt (ISO string → epoch ms)
 */
export function toPendingOrder(so: ServerOrder): PendingOrder {
  return {
    id: so.id,
    symbol: so.symbol,
    type: so.kind, // 'limit' | 'stop'
    direction: so.direction,
    volume: so.volume,
    triggerPrice: so.triggerPrice,
    placedPrice: so.placedPrice,
    stopLoss: so.stopLoss,
    takeProfit: so.takeProfit,
    createdAt: new Date(so.createdAt).getTime(),
  }
}

/**
 * ServerTrade → ClosedTrade.
 *
 * Field mapping:
 *  - openPrice   → entryPrice
 *  - closePrice  → exitPrice
 *  - openTime    → openedAt (epoch ms)
 *  - closeTime   → closedAt (epoch ms)
 *  - netPnl      → realizedPnl
 *
 * Fields not present on ServerTrade but required by ClosedTrade
 * (contractSize, digits, margin) are synthesised from the asset registry
 * where possible, or set to sensible defaults. These are display-only in
 * the closed-trade history so precision isn't critical.
 */
export function toClosedTrade(st: ServerTrade): ClosedTrade {
  const asset = getAsset(st.symbol)
  const contractSize = asset.contractSize
  const digits = asset.digits
  const margin = 0

  return {
    id: st.id,
    symbol: st.symbol,
    direction: st.direction,
    volume: st.volume,
    entryPrice: st.openPrice,
    contractSize,
    digits,
    stopLoss: null, // not stored on the trade row
    takeProfit: null,
    openedAt: new Date(st.openTime).getTime(),
    margin,
    exitPrice: st.closePrice,
    closedAt: new Date(st.closeTime).getTime(),
    realizedPnl: st.netPnl,
    reason: st.reason,
  }
}

/**
 * ServerAccount → AccountState.
 *
 * Maps the rich server-authoritative account model into the simpler client
 * AccountState that the TradingProvider context consumers already depend on.
 */
export function toAccountState(sa: ServerAccount): AccountState {
  return {
    startingBalance: sa.startingBalance,
    balance: sa.balance,
    dailyStartBalance: sa.dailyStartBalance,
    status: sa.status === "breached" ? "breached" : "active",
    breachReason: sa.breachReason,
  }
}
