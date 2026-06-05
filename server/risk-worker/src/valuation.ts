// Pure valuation logic for the risk engine. No I/O — deterministic and unit
// testable. Mirrors the app's lib/trading/assets.ts + TradingProvider math so
// server-computed equity exactly matches what the UI showed.
//
// Convention: positions are marked on the CLOSE side of the spread
//   - long  (buy)  → exit at the BID  (mid - spread/2)
//   - short (sell) → exit at the ASK  (mid + spread/2)

import { ASSET_MAP, type WorkerAsset } from "./assets.js"

export const LEVERAGE = 100
export const COMMISSION_PER_LOT = 3 // USD per lot per side

export type Direction = "buy" | "sell"

export interface PositionLike {
  symbol: string
  direction: Direction
  volume: number
  openPrice: number
  contractSize: number
}

/** Round-turn commission (entry + exit) in USD for a lot size. */
export function commissionFor(volume: number): number {
  return COMMISSION_PER_LOT * 2 * volume
}

/** Synthetic spread in price units, tuned per asset class (mirrors the app). */
export function spreadOf(asset: WorkerAsset, price: number): number {
  switch (asset.category) {
    case "forex": {
      const pip = Math.pow(10, -(asset.digits - 1))
      return 1.2 * pip
    }
    case "crypto":
      return price * 0.0002
    case "commodities":
      return price * 0.00012
    default:
      return price * 0.0001
  }
}

/** Entry fill when OPENING: buys pay the ask, sells hit the bid. */
export function openFillPrice(direction: Direction, mid: number, spread: number): number {
  const half = spread / 2
  return direction === "buy" ? mid + half : mid - half
}

/** Exit fill when CLOSING/marking: buys exit on the bid, sells on the ask. */
export function closeFillPrice(direction: Direction, mid: number, spread: number): number {
  const half = spread / 2
  return direction === "buy" ? mid - half : mid + half
}

/** The quote currency a symbol's raw PnL is denominated in. */
export function quoteCurrencyOf(symbol: string): string {
  if (symbol.endsWith("USDT")) return "USD"
  if (symbol.endsWith("USD")) return "USD"
  if (symbol.length === 6) return symbol.slice(3)
  return "USD"
}

/** USD value of one unit of `currency` from the live price map (direct/inverse). */
export function usdPerUnit(currency: string, prices: Record<string, number>): number {
  if (currency === "USD") return 1
  const direct = prices[`${currency}USD`]
  if (Number.isFinite(direct) && (direct as number) > 0) return direct as number
  const inverse = prices[`USD${currency}`]
  if (Number.isFinite(inverse) && (inverse as number) > 0) return 1 / (inverse as number)
  return 1
}

/** GROSS USD PnL at an explicit exit fill (no costs). */
export function grossPnlUsd(
  p: PositionLike,
  exitFill: number,
  prices: Record<string, number>,
): number {
  const sign = p.direction === "buy" ? 1 : -1
  const rawQuote = (exitFill - p.openPrice) * sign * p.volume * p.contractSize
  return rawQuote * usdPerUnit(quoteCurrencyOf(p.symbol), prices)
}

/** USD margin required to open `volume` lots at `fillPrice`. */
export function marginRequired(
  asset: WorkerAsset,
  volume: number,
  fillPrice: number,
  prices: Record<string, number>,
): number {
  const notionalUsd =
    volume * asset.contractSize * fillPrice * usdPerUnit(quoteCurrencyOf(asset.symbol), prices)
  return notionalUsd / LEVERAGE
}

export interface MarkResult {
  /** Close-side exit fill used to mark the position. */
  exitFill: number
  grossPnl: number
  /** Net floating PnL = gross - round-turn commission (matches the client). */
  floatingPnl: number
  commission: number
}

/**
 * Mark a position to market on the close side. Returns null when there is no
 * live price for the symbol (the caller should leave such positions untouched
 * rather than valuing them at a stale price).
 */
export function markPosition(
  p: PositionLike,
  prices: Record<string, number>,
): MarkResult | null {
  const asset = ASSET_MAP[p.symbol]
  const mid = prices[p.symbol]
  if (!asset || !Number.isFinite(mid)) return null
  const exitFill = closeFillPrice(p.direction, mid as number, spreadOf(asset, mid as number))
  const gross = grossPnlUsd(p, exitFill, prices)
  const commission = commissionFor(p.volume)
  return { exitFill, grossPnl: gross, floatingPnl: gross - commission, commission }
}

/**
 * Account equity = balance + sum of net floating PnL across open positions.
 * Positions with no live price contribute 0 (left unmarked this tick).
 */
export function computeEquity(
  balance: number,
  positions: PositionLike[],
  prices: Record<string, number>,
): number {
  let floating = 0
  for (const p of positions) {
    const m = markPosition(p, prices)
    if (m) floating += m.floatingPnl
  }
  return balance + floating
}
