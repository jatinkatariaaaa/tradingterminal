// Row shapes the risk worker reads and the inputs of the SECURITY DEFINER functions it calls.

export type Direction = "buy" | "sell"
export type CloseReason = "tp" | "sl" | "manual" | "breach"
export type AccountStatus = "active" | "passed" | "breached" | "funded" | "suspended"

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
  leverage: number
  /** Sent by risk_cycle only (engine v4). */
  highest_equity?: number | null
  /** Sent by risk_cycle only (engine v4). */
  min_trading_days?: number | null
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

export interface BreachMark {
  position_id: string
  exit_fill: number
  gross_pnl: number
  commission: number
}

export interface PriceRow {
  symbol: string
  price: number
  updated_at: string
}

export interface CycleTick {
  id: string
  equity: number
  peak: number
}

export interface CycleTickResult {
  id: string
  status?: AccountStatus
  error?: string
  /** What the row stores after the tick (numeric(18,2)), so the worker knows without a re-read. */
  equity?: number | null
  highest_equity?: number | null
}

export interface Fingerprints {
  accounts?: string
  positions?: string
  orders?: string
}

/** risk_cycle result. A snapshot part is null when the worker already holds it (fingerprint unchanged). */
export interface CycleResult {
  ticks: CycleTickResult[]
  now: string
  next_daily_reset_at: string
  due_daily_reset: string[]
  fp: Required<Fingerprints>
  accounts: AccountRow[] | null
  positions: PositionRow[] | null
  orders: OrderRow[] | null
}

/** Everything the engines need from the database. db.ts implements it with supabase-js. */
export interface RiskDb {
  fetchTradableAccounts(): Promise<AccountRow[]>
  fetchAllPositions(accountIds: string[]): Promise<PositionRow[]>
  fetchAllWorkingOrders(accountIds: string[]): Promise<OrderRow[]>
  fetchAccountSnapshot(accountId: string): Promise<AccountRow>
  applyRiskTick(accountId: string, equity: number): Promise<AccountStatus>
  closePosition(args: { positionId: string; exitFill: number; grossPnl: number; commission: number; reason: CloseReason }): Promise<void>
  fillOrder(args: { orderId: string; entryFill: number; contractSize: number; digits: number; margin: number; commission: number }): Promise<boolean>
  breachAccount(args: { accountId: string; equity: number; kind: "daily_breach" | "overall_breach"; reason: string; marks: BreachMark[] }): Promise<void>
  passAccount(args: { accountId: string; equity: number; marks: BreachMark[] }): Promise<AccountRow>
  upsertPrices(rows: PriceRow[]): Promise<void>
  riskCycle(ticks: CycleTick[], prices: PriceRow[], known: Fingerprints): Promise<CycleResult>
}

/** The live price map the ingestion feeds keep current. */
export interface PriceFeed {
  /** Latest mid for a symbol. */
  get(symbol: string): number | undefined
  /** Copy of every latest mid. */
  all(): Record<string, number>
  /** True once a real feed (not a fallback) delivered a price for the symbol. */
  isReal(symbol: string): boolean
}

export type CrmStatus = "passed" | "breached"
export type CrmNotify = (payload: {
  login: string
  terminal_account_id: string
  current_balance: number
  current_equity: number
  status: CrmStatus
}) => Promise<void>
