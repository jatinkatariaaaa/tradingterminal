// Core domain types for the prop-firm virtual trading terminal.

export type AssetCategory = "forex" | "crypto" | "commodities"

// Where a symbol gets its live price from.
//  - "binance": real-time prices via the public Binance combined !ticker@arr stream
//  - "massive": real prices anchored from the massive.com API, kept live by the simulator
//  - "sim":     pure internal high-fidelity math simulator (e.g. energy)
export type FeedSource = "binance" | "massive" | "sim"

export interface Asset {
  /** Internal symbol id used across the app, e.g. "BTCUSDT" or "EURUSD". */
  symbol: string
  /** Human label shown in the UI, e.g. "BTC / USD". */
  label: string
  category: AssetCategory
  /** Which data feed powers this asset. */
  feed: FeedSource
  /** Uppercase Binance ticker (only for feed === "binance"), e.g. "BTCUSDT". */
  binanceStream?: string
  /** massive.com / Polygon-style ticker (only for feed === "massive"), e.g. "C:EURUSD". */
  massiveTicker?: string
  /** Yahoo Finance ticker used for real, near-live anchors, e.g. "EURUSD=X" or "GC=F". */
  yahooTicker?: string
  /** Baseline / seed price used by the simulator and as the initial display price. */
  basePrice: number
  /** Number of decimals to render for this asset. */
  digits: number
  /**
   * Contract size: how many base units one lot represents.
   * Used for P&L: pnl = (exit - entry) * volume * contractSize * directionSign
   *  - Forex: 100,000 units per standard lot
   *  - Gold (XAUUSD): 100 oz per lot
   *  - Crypto: 1 coin per "lot" (volume is expressed directly in coins)
   */
  contractSize: number
  /** Default lot/volume increment in the order ticket. */
  lotStep: number
}

export type OrderType = "market" | "limit" | "stop"
export type Direction = "buy" | "sell"

export interface OpenPosition {
  id: string
  symbol: string
  direction: Direction
  /** Lots / volume. */
  volume: number
  /** Price at which the position was opened (filled, spread-adjusted). */
  entryPrice: number
  contractSize: number
  digits: number
  /** Optional protective levels. */
  stopLoss: number | null
  takeProfit: number | null
  openedAt: number
  /** USD margin locked by this position at open (notional / leverage). */
  margin: number
}

export interface ClosedTrade extends OpenPosition {
  exitPrice: number
  closedAt: number
  realizedPnl: number
  /** Why the trade closed. */
  reason: "tp" | "sl" | "manual" | "breach"
}

export type AccountStatus = "active" | "breached"

export interface AccountState {
  startingBalance: number
  /** Realized balance (updates only when trades close). */
  balance: number
  /** Balance the current day started with (basis for daily drawdown). */
  dailyStartBalance: number
  status: AccountStatus
  breachReason: string | null
}
