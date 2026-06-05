"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useMarketData } from "@/hooks/use-market-data"
import {
  ASSETS,
  closeFillPrice,
  commissionFor,
  getAsset,
  marginRequired,
  openFillPrice,
  quoteCurrencyOf,
  roundToLotStep,
  spreadOf,
  usdPerUnit,
} from "@/lib/trading/assets"
import type {
  AccountState,
  ClosedTrade,
  Direction,
  OpenPosition,
  OrderType,
} from "@/lib/trading/types"
import { useServerPortfolio } from "@/hooks/use-server-portfolio"
import { useServerAccounts } from "@/hooks/use-server-accounts"
import { toOpenPosition, toPendingOrder, toClosedTrade, toAccountState } from "@/lib/trading/server-adapters"
import { useToast } from "@/hooks/use-toast"

// ---------------------------------------------------------------------------
// Constants (used as fallbacks when no server account is connected)
// ---------------------------------------------------------------------------
const STARTING_BALANCE = 100_000
const DAILY_DRAWDOWN_PCT = 0.05 // 5% of the day's starting balance
const MAX_DRAWDOWN_PCT = 0.1 // 10% of the absolute starting balance

const FALLBACK_ACCOUNT: AccountState = {
  startingBalance: STARTING_BALANCE,
  balance: STARTING_BALANCE,
  dailyStartBalance: STARTING_BALANCE,
  status: "active",
  breachReason: null,
}

// Shared, draggable order draft. Both the Order Ticket and the chart overlay
// read and write this so the numeric inputs and the on-chart lines stay synced.
export interface OrderDraft {
  type: OrderType
  direction: Direction
  volume: number
  /** Trigger price for limit / stop orders. */
  triggerPrice: number
  slEnabled: boolean
  slPrice: number
  tpEnabled: boolean
  tpPrice: number
}

export interface PendingOrder {
  id: string
  symbol: string
  type: Exclude<OrderType, "market">
  direction: Direction
  volume: number
  triggerPrice: number
  /** Market price at the moment the order was placed. Used to ensure the order
   *  only fills when price genuinely crosses the trigger from the correct side
   *  (so it never executes instantly). */
  placedPrice: number
  stopLoss: number | null
  takeProfit: number | null
  createdAt: number
}

/** Successful fill / placement summary so the UI can confirm the order. */
export interface ExecutionFill {
  ok: true
  id: string
  kind: "market" | "pending"
  type: OrderType
  direction: Direction
  symbol: string
  volume: number
  /** Fill price for market orders, trigger price for pending orders. */
  price: number
  /** USD margin locked by this order. */
  margin: number
  /** Round-turn commission (USD) for this order's volume. */
  commission: number
}

/** Rejection (e.g. not enough free margin) so the UI can surface the reason. */
export interface ExecutionRejection {
  ok: false
  reason: string
}

export type ExecutionResult = ExecutionFill | ExecutionRejection

interface DerivedPnl {
  /** Floating P&L summed across all open positions (net of spread + commission). */
  floatingPnl: number
  /** balance + floatingPnl. */
  equity: number
  /** USD margin currently locked by open positions. */
  usedMargin: number
  /** equity − usedMargin: capital available to open new positions. */
  freeMargin: number
  /** equity / usedMargin × 100 (null when flat). Stop-out territory < ~50%. */
  marginLevel: number | null
  dailyDrawdownUsed: number
  dailyDrawdownLimit: number
  maxDrawdownUsed: number
  maxDrawdownLimit: number
}

interface TradingContextValue {
  // Market
  prices: Record<string, number>
  binanceConnected: boolean
  marketPrice: number
  // Active asset
  activeSymbol: string
  setActiveSymbol: (symbol: string) => void
  // Account & risk
  account: AccountState
  derived: DerivedPnl
  // Positions
  openPositions: OpenPosition[]
  pendingOrders: PendingOrder[]
  closedTrades: ClosedTrade[]
  /** Net floating (mark-to-market) USD P&L for a position. The `price` arg is
   *  accepted for backward compatibility but ignored — valuation always uses the
   *  live close-side quote so spread + commission are reflected. */
  pnlFor: (position: OpenPosition, price?: number) => number
  draft: OrderDraft
  setDraft: (patch: Partial<OrderDraft>) => void

  // ---- Manage / modify state (shared by right panel + chart overlay) ----
  /** Id of the position currently selected in the table to view SL/TP. */
  selectedPositionId: string | null
  setSelectedPositionId: (id: string | null) => void

  /** Id of the position currently being managed, or null when not managing. */
  managePositionId: string | null
  /** Working SL/TP for the managed position; applied live as they change. */
  manageSL: number | null
  manageTP: number | null
  /** Open the manage view for a position, seeding its current SL/TP. */
  beginManage: (id: string) => void
  /** Close the manage view. */
  endManage: () => void
  /** Update the managed position's stop loss live (null clears it). */
  setManageSL: (price: number | null) => void
  /** Update the managed position's take profit live (null clears it). */
  setManageTP: (price: number | null) => void

  // Actions (now async — hit /api/trade/* routes)
  executeOrder: () => Promise<ExecutionResult | null>
  closePosition: (id: string) => Promise<void>
  /** Close part of a position's volume at the current price, leaving the rest open. */
  partialClose: (id: string, volume: number) => Promise<void>
  /** Manually adjust the stop loss / take profit of an open position (null clears). */
  modifyPosition: (id: string, stopLoss: number | null, takeProfit: number | null) => Promise<void>
  /** Panic button — liquidate every open position at the current market price. */
  closeAllPositions: () => Promise<void>
  cancelPending: (id: string) => Promise<void>
  resetAccount: () => void

  // Server integration
  accountId: string | null
  setAccountId: (id: string | null) => void
  isSubmitting: boolean
  lastError: string | null
}

// The context is split into three slices so consumers only re-render for the
// data they actually read:
//  - Market: the live feed + derived equity/drawdown — changes ~10x/second.
//  - State:  account, positions, draft, manage view — changes on real events.
//  - Actions: dispatchers — stable for the life of the provider.
type MarketContextValue = Pick<
  TradingContextValue,
  "prices" | "binanceConnected" | "marketPrice" | "derived"
>
type TradingStateValue = Pick<
  TradingContextValue,
  | "activeSymbol"
  | "account"
  | "openPositions"
  | "pendingOrders"
  | "closedTrades"
  | "draft"
  | "selectedPositionId"
  | "managePositionId"
  | "manageSL"
  | "manageTP"
  | "accountId"
  | "isSubmitting"
  | "lastError"
>
type TradingActionsValue = Pick<
  TradingContextValue,
  | "setActiveSymbol"
  | "setDraft"
  | "setSelectedPositionId"
  | "beginManage"
  | "endManage"
  | "setManageSL"
  | "setManageTP"
  | "pnlFor"
  | "executeOrder"
  | "closePosition"
  | "partialClose"
  | "modifyPosition"
  | "closeAllPositions"
  | "cancelPending"
  | "resetAccount"
  | "setAccountId"
>

const MarketContext = createContext<MarketContextValue | null>(null)
const TradingStateContext = createContext<TradingStateValue | null>(null)
const TradingActionsContext = createContext<TradingActionsValue | null>(null)

/** Live feed + derived equity/drawdown. Updates on every tick. */
export function useMarket(): MarketContextValue {
  const ctx = useContext(MarketContext)
  if (!ctx) throw new Error("useMarket must be used within a TradingProvider")
  return ctx
}

/** Account, positions, draft and manage view. Updates only on real events. */
export function useTradingState(): TradingStateValue {
  const ctx = useContext(TradingStateContext)
  if (!ctx) throw new Error("useTradingState must be used within a TradingProvider")
  return ctx
}

/** Stable action dispatchers — safe to read without subscribing to live data. */
export function useTradingActions(): TradingActionsValue {
  const ctx = useContext(TradingActionsContext)
  if (!ctx) throw new Error("useTradingActions must be used within a TradingProvider")
  return ctx
}

/**
 * Backward-compatible convenience hook returning the full value. Components that
 * use this re-render whenever any slice changes; prefer the granular hooks above
 * (useMarket / useTradingState / useTradingActions) where render cost matters.
 */
export function useTrading(): TradingContextValue {
  return { ...useMarket(), ...useTradingState(), ...useTradingActions() }
}

// ---------------------------------------------------------------------------
// Optimistic floating P&L (client-side, using live prices for responsiveness)
// ---------------------------------------------------------------------------

/**
 * NET floating (mark-to-market) USD P&L. The position is valued at the *close*
 * side of the live spread (long → bid, short → ask) and round-turn commission is
 * deducted, so even a brand-new position correctly shows the round-trip cost
 * (spread + commission) as a small initial loss — exactly like a real broker.
 */
function floatingPnlUsd(p: OpenPosition, prices: Record<string, number>): number {
  const asset = getAsset(p.symbol)
  const mid = Number.isFinite(prices[p.symbol]) ? prices[p.symbol] : p.entryPrice
  const exitFill = closeFillPrice(p.direction, mid, spreadOf(asset, mid))
  const sign = p.direction === "buy" ? 1 : -1
  const rawQuote = (exitFill - p.entryPrice) * sign * p.volume * p.contractSize
  const grossUsd = rawQuote * usdPerUnit(quoteCurrencyOf(p.symbol), prices)
  return grossUsd - commissionFor(p.volume)
}

/**
 * A sensible, valid trigger price for a pending order, offset to the correct
 * side of the market so it never fills instantly.
 */
function defaultTrigger(
  type: OrderType,
  direction: Direction,
  market: number,
  digits: number,
): number {
  const pad = market * 0.002
  const round = (v: number) => Number(v.toFixed(digits))
  if (type === "limit") {
    return round(direction === "buy" ? market - pad : market + pad)
  }
  return round(direction === "buy" ? market + pad : market - pad)
}

function freshDraft(basePrice: number, digits: number): OrderDraft {
  const pad = basePrice * 0.005
  const round = (v: number) => Number(v.toFixed(digits))
  return {
    type: "market",
    direction: "buy",
    volume: 1,
    triggerPrice: round(basePrice),
    slEnabled: false,
    slPrice: round(basePrice - pad),
    tpEnabled: false,
    tpPrice: round(basePrice + pad),
  }
}

// ---------------------------------------------------------------------------
// TradingProvider — server-authoritative (Phase 3, Step 3c)
// ---------------------------------------------------------------------------

export interface TradingProviderProps {
  children: ReactNode
  initialAccountId?: string | null
}

export function TradingProvider({ children, initialAccountId }: TradingProviderProps) {
  const { toast } = useToast()
  const { prices, binanceConnected } = useMarketData()

  const [activeSymbol, setActiveSymbolState] = useState<string>(ASSETS[0].symbol)
  const activeAsset = getAsset(activeSymbol)
  const marketPrice = prices[activeSymbol] ?? activeAsset.basePrice

  // ---- Server account integration ----
  const { accounts: serverAccounts } = useServerAccounts()
  const [accountId, setAccountId] = useState<string | null>(initialAccountId ?? null)

  // Sync local state if initialAccountId prop changes.
  useEffect(() => {
    console.log("[TradingProvider] Prop initialAccountId updated:", initialAccountId)
    if (initialAccountId) {
      setAccountId(initialAccountId)
    }
  }, [initialAccountId])

  // Auto-select the first active account when accounts load and none is selected.
  useEffect(() => {
    console.log("[TradingProvider] serverAccounts loaded:", serverAccounts.length, "accounts. Active accountId state:", accountId)
    if (accountId) return
    const active = serverAccounts.find(
      (a) => a.status === "active" || a.status === "funded",
    )
    if (active) {
      console.log("[TradingProvider] Auto-selecting active account:", active.id)
      setAccountId(active.id)
    }
  }, [serverAccounts, accountId])

  // ---- Server-authoritative state via Realtime ----
  const { positions: serverPositions, orders: serverOrders, trades: serverTrades, refresh: refreshPortfolio } =
    useServerPortfolio(accountId)

  // Adapt server types → client types so all downstream components work unchanged.
  const openPositions = useMemo(
    () => serverPositions.map(toOpenPosition),
    [serverPositions],
  )
  const pendingOrders = useMemo(
    () => serverOrders.map(toPendingOrder),
    [serverOrders],
  )
  const closedTrades = useMemo(
    () => serverTrades.map(toClosedTrade),
    [serverTrades],
  )

  // Account state from server, with fallback for when no account is loaded.
  const serverAccount = serverAccounts.find((a) => a.id === accountId)
  const account: AccountState = serverAccount
    ? toAccountState(serverAccount)
    : FALLBACK_ACCOUNT

  // ---- Submission state ----
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)

  // ---- Order draft (unchanged — purely local UI state) ----
  const [draft, setDraftState] = useState<OrderDraft>(() =>
    freshDraft(activeAsset.basePrice, activeAsset.digits),
  )

  // Which position is being managed in the right panel, plus its working SL/TP.
  const [selectedPositionId, setSelectedPositionId] = useState<string | null>(null)
  const [managePositionId, setManagePositionId] = useState<string | null>(null)
  const [manageSL, setManageSLState] = useState<number | null>(null)
  const [manageTP, setManageTPState] = useState<number | null>(null)

  // Keep refs in sync so callbacks can read fresh data without re-subscribing.
  const pricesRef = useRef(prices)
  pricesRef.current = prices
  const draftRef = useRef(draft)
  draftRef.current = draft
  const activeSymbolRef = useRef(activeSymbol)
  activeSymbolRef.current = activeSymbol
  const accountIdRef = useRef(accountId)
  accountIdRef.current = accountId
  const openPositionsRef = useRef(openPositions)
  openPositionsRef.current = openPositions

  // ---- Draft helpers ----
  const setDraft = useCallback((patch: Partial<OrderDraft>) => {
    setDraftState((prev) => {
      const next = { ...prev, ...patch }
      const typeChanged = patch.type !== undefined && patch.type !== prev.type
      const dirChanged = patch.direction !== undefined && patch.direction !== prev.direction
      if (next.type !== "market" && (typeChanged || dirChanged)) {
        const symbol = activeSymbolRef.current
        const asset = getAsset(symbol)
        const live = pricesRef.current[symbol]
        const market = Number.isFinite(live) ? live : asset.basePrice
        next.triggerPrice = defaultTrigger(next.type, next.direction, market, asset.digits)
      }
      return next
    })
  }, [])

  // Reset the order draft around the new asset's price whenever it changes.
  const setActiveSymbol = useCallback((symbol: string) => {
    setActiveSymbolState(symbol)
    const asset = getAsset(symbol)
    setDraftState((prev) => {
      const live = pricesRef.current[symbol]
      const base = Number.isFinite(live) ? live : asset.basePrice
      const pad = base * 0.005
      const round = (v: number) => Number(v.toFixed(asset.digits))
      return {
        ...prev,
        triggerPrice: round(base),
        slPrice: round(base - pad),
        tpPrice: round(base + pad),
        slEnabled: false,
        tpEnabled: false,
        type: "market",
      }
    })
  }, [])

  // ---- Derived account metrics (optimistic, recomputed on every tick) ----
  // Uses server-authoritative balance but client-side floating P&L from live
  // prices for a responsive display. Server equity arrives via Realtime ~1-2s
  // later and reconciles any drift.
  const derived = useMemo<DerivedPnl>(() => {
    let floating = 0
    let usedMargin = 0
    for (const p of openPositions) {
      floating += floatingPnlUsd(p, prices)
      usedMargin += p.margin
    }
    const equity = account.balance + floating

    // Use server account drawdown parameters when available, else defaults.
    const dailyDrawdownPct = serverAccount?.maxDailyDrawdown ?? DAILY_DRAWDOWN_PCT
    const maxDrawdownPct = serverAccount?.maxOverallDrawdown ?? MAX_DRAWDOWN_PCT
    const dailyLimit = account.dailyStartBalance * dailyDrawdownPct
    const maxLimit = account.startingBalance * maxDrawdownPct

    return {
      floatingPnl: floating,
      equity,
      usedMargin,
      freeMargin: equity - usedMargin,
      marginLevel: usedMargin > 0 ? (equity / usedMargin) * 100 : null,
      dailyDrawdownUsed: Math.max(0, account.dailyStartBalance - equity),
      dailyDrawdownLimit: dailyLimit,
      maxDrawdownUsed: Math.max(0, account.startingBalance - equity),
      maxDrawdownLimit: maxLimit,
    }
  }, [openPositions, prices, account, serverAccount])

  // If the managed position is closed (by SL/TP, breach, or manual close on
  // another device), exit the manage view so the right panel falls back to the
  // order ticket.
  useEffect(() => {
    if (managePositionId && !openPositions.some((p) => p.id === managePositionId)) {
      setManagePositionId(null)
      setManageSLState(null)
      setManageTPState(null)
    }
  }, [managePositionId, openPositions])

  useEffect(() => {
    if (selectedPositionId && !openPositions.some((p) => p.id === selectedPositionId)) {
      setSelectedPositionId(null)
    }
  }, [selectedPositionId, openPositions])

  // ---- Manage view: seed/clear + live SL/TP (local UI drafts). ----
  // After the cutover, setManageSL/setManageTP only update the local draft
  // values. The actual position SL/TP is modified on the server when the user
  // clicks "Modify" in the manage panel (which calls modifyPosition → API).
  const beginManage = useCallback((id: string) => {
    const positions = openPositionsRef.current
    const target = positions.find((p) => p.id === id)
    if (!target) return
    const asset = getAsset(target.symbol)
    const isBuy = target.direction === "buy"
    const pad = target.entryPrice * 0.0015
    const round = (v: number) => Number(v.toFixed(asset.digits))
    const seededSL = target.stopLoss ?? round(isBuy ? target.entryPrice - pad : target.entryPrice + pad)
    const seededTP = target.takeProfit ?? round(isBuy ? target.entryPrice + pad : target.entryPrice - pad)
    setManagePositionId(id)
    setManageSLState(seededSL)
    setManageTPState(seededTP)
  }, [])

  const endManage = useCallback(() => {
    setManagePositionId(null)
    setManageSLState(null)
    setManageTPState(null)
  }, [])

  // These only update the local draft values (displayed on chart lines and in
  // the manage panel). The position's actual SL/TP on the server is modified
  // only when `modifyPosition` is called (user clicks "Modify").
  const setManageSL = useCallback((price: number | null) => {
    setManageSLState(price)
  }, [])

  const setManageTP = useCallback((price: number | null) => {
    setManageTPState(price)
  }, [])

  // ---- Stable floating-P&L helper for consumers. ----
  const pnlFor = useCallback(
    (p: OpenPosition, _price?: number) => floatingPnlUsd(p, pricesRef.current),
    [],
  )

  // =========================================================================
  // Server-authoritative actions (hit /api/trade/* routes)
  // =========================================================================

  const executeOrder = useCallback(async (): Promise<ExecutionResult | null> => {
    const acctId = accountIdRef.current
    console.log("[TradingProvider] Executing order. accountIdRef.current:", acctId)
    if (!acctId) return { ok: false, reason: "No trading account selected." }
    if (isSubmitting) return null

    const draft = draftRef.current
    const symbol = activeSymbolRef.current
    const prices = pricesRef.current
    const asset = getAsset(symbol)
    const livePrice = prices[symbol]
    const mid = Number.isFinite(livePrice) ? livePrice : asset.basePrice
    const volume = roundToLotStep(Math.max(asset.lotStep, draft.volume), asset.lotStep)
    const spread = spreadOf(asset, mid)
    const sl = draft.slEnabled ? draft.slPrice : null
    const tp = draft.tpEnabled ? draft.tpPrice : null
    const commission = commissionFor(volume)

    setIsSubmitting(true)
    setLastError(null)

    try {
      if (draft.type === "market") {
        // ---- Market order → POST /api/trade/open ----
        const res = await fetch("/api/trade/open", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountId: acctId,
            symbol,
            direction: draft.direction,
            volume,
            stopLoss: sl,
            takeProfit: tp,
          }),
        })
        const data = await res.json()
        if (!res.ok) {
          setIsSubmitting(false)
          return { ok: false, reason: data.error ?? "Order rejected by server." }
        }
        
        // Immediately refresh state for instant feedback.
        await refreshPortfolio()
        
        // Construct the fill result from the API response.
        const entryFill = openFillPrice(draft.direction, mid, spread)
        const margin = marginRequired(asset, volume, entryFill, prices)
        setDraftState((prev) => ({ ...prev, slEnabled: false, tpEnabled: false }))
        setIsSubmitting(false)
        return {
          ok: true,
          id: data.position?.id ?? `server-${Date.now()}`,
          kind: "market",
          type: "market",
          direction: draft.direction,
          symbol,
          volume,
          price: Number(data.position?.open_price) || entryFill,
          margin,
          commission,
        }
      }

      // ---- Pending order (limit/stop) → POST /api/trade/place-order ----
      const res = await fetch("/api/trade/place-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: acctId,
          symbol,
          direction: draft.direction,
          kind: draft.type, // 'limit' | 'stop'
          volume,
          triggerPrice: draft.triggerPrice,
          stopLoss: sl,
          takeProfit: tp,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setIsSubmitting(false)
        return { ok: false, reason: data.error ?? "Order rejected by server." }
      }
      
      // Immediately refresh state for instant feedback.
      await refreshPortfolio()
      
      setDraftState((prev) => ({ ...prev, slEnabled: false, tpEnabled: false }))
      const pendingFill = openFillPrice(draft.direction, draft.triggerPrice, spreadOf(asset, draft.triggerPrice))
      setIsSubmitting(false)
      return {
        ok: true,
        id: data.order?.id ?? `server-${Date.now()}`,
        kind: "pending",
        type: draft.type,
        direction: draft.direction,
        symbol,
        volume,
        price: draft.triggerPrice,
        margin: marginRequired(asset, volume, pendingFill, prices),
        commission,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error."
      setLastError(msg)
      setIsSubmitting(false)
      return { ok: false, reason: msg }
    }
  }, [isSubmitting, refreshPortfolio])

  const closePosition = useCallback(async (id: string) => {
    const positions = openPositionsRef.current
    const target = positions.find((p) => p.id === id)
    if (!target) return
    setIsSubmitting(true)
    setLastError(null)
    try {
      const res = await fetch("/api/trade/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ positionId: id, symbol: target.symbol }),
      })
      if (!res.ok) {
        const data = await res.json()
        const err = data.error ?? "Failed to close position."
        setLastError(err)
        toast({
          title: "Failed to Close Position",
          description: err,
          variant: "destructive",
        })
      } else {
        toast({
          title: "Position Closed",
          description: `Closed ${target.volume} lots of ${target.symbol} at market.`,
        })
        await refreshPortfolio()
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error."
      setLastError(msg)
      toast({
        title: "Network Error",
        description: msg,
        variant: "destructive",
      })
    } finally {
      setIsSubmitting(false)
    }
  }, [refreshPortfolio, toast])

  const partialClose = useCallback(async (id: string, closeVolume: number) => {
    const positions = openPositionsRef.current
    const target = positions.find((p) => p.id === id)
    if (!target) return
    if (closeVolume >= target.volume) {
      return closePosition(id)
    }

    setIsSubmitting(true)
    setLastError(null)
    try {
      const res = await fetch("/api/trade/partial-close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ positionId: id, symbol: target.symbol, volume: closeVolume }),
      })
      if (!res.ok) {
        const data = await res.json()
        const err = data.error ?? "Failed to partially close position."
        setLastError(err)
        toast({
          title: "Failed to Partial Close",
          description: err,
          variant: "destructive",
        })
      } else {
        toast({
          title: "Partial Close Executed",
          description: `Closed ${closeVolume} lots of ${target.symbol} at market.`,
        })
        await refreshPortfolio()
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error."
      setLastError(msg)
      toast({
        title: "Network Error",
        description: msg,
        variant: "destructive",
      })
    } finally {
      setIsSubmitting(false)
    }
  }, [closePosition, refreshPortfolio, toast])

  const modifyPosition = useCallback(
    async (id: string, stopLoss: number | null, takeProfit: number | null) => {
      setIsSubmitting(true)
      setLastError(null)
      try {
        const res = await fetch("/api/trade/modify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ positionId: id, stopLoss, takeProfit }),
        })
        if (!res.ok) {
          const data = await res.json()
          const err = data.error ?? "Failed to modify position."
          setLastError(err)
          toast({
            title: "Failed to Modify Position",
            description: err,
            variant: "destructive",
          })
        } else {
          toast({
            title: "SL/TP Modified",
            description: "Successfully updated stop loss and take profit levels.",
          })
          await refreshPortfolio()
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Network error."
        setLastError(msg)
        toast({
          title: "Network Error",
          description: msg,
          variant: "destructive",
        })
      } finally {
        setIsSubmitting(false)
      }
    },
    [refreshPortfolio, toast],
  )

  const closeAllPositions = useCallback(async () => {
    const positions = openPositionsRef.current
    if (positions.length === 0) return
    setIsSubmitting(true)
    setLastError(null)
    try {
      // Fire all close requests in parallel.
      const results = await Promise.all(
        positions.map(async (p) => {
          try {
            const res = await fetch("/api/trade/close", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ positionId: p.id, symbol: p.symbol }),
            })
            return { ok: res.ok, symbol: p.symbol }
          } catch {
            return { ok: false, symbol: p.symbol }
          }
        }),
      )
      const failures = results.filter((r) => !r.ok)
      if (failures.length > 0) {
        const msg = `${failures.length} of ${positions.length} positions failed to close.`
        setLastError(msg)
        toast({
          title: "Partial Closure Failure",
          description: msg,
          variant: "destructive",
        })
      } else {
        toast({
          title: "All Positions Closed",
          description: `Successfully closed all ${positions.length} open positions.`,
        })
      }
      await refreshPortfolio()
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error."
      setLastError(msg)
      toast({
        title: "Network Error",
        description: msg,
        variant: "destructive",
      })
    } finally {
      setIsSubmitting(false)
    }
  }, [refreshPortfolio, toast])

  const cancelPending = useCallback(async (id: string) => {
    setIsSubmitting(true)
    setLastError(null)
    try {
      const res = await fetch("/api/trade/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: id }),
      })
      if (!res.ok) {
        const data = await res.json()
        const err = data.error ?? "Failed to cancel order."
        setLastError(err)
        toast({
          title: "Failed to Cancel Order",
          description: err,
          variant: "destructive",
        })
      } else {
        toast({
          title: "Order Cancelled",
          description: "Pending order cancelled successfully.",
        })
        await refreshPortfolio()
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error."
      setLastError(msg)
      toast({
        title: "Network Error",
        description: msg,
        variant: "destructive",
      })
    } finally {
      setIsSubmitting(false)
    }
  }, [refreshPortfolio, toast])

  const resetAccount = useCallback(() => {
    // In a server-authoritative world, account reset would need a server
    // endpoint. For now this is a no-op — the server manages account lifecycle.
    setLastError("Account reset is managed server-side. Contact support.")
    toast({
      title: "Action Restricted",
      description: "Account reset is managed server-side. Contact support.",
      variant: "default",
    })
  }, [toast])

  // =========================================================================
  // Context slices
  // =========================================================================

  // Fast slice — recreated on every tick (prices/marketPrice/derived move).
  const marketValue = useMemo<MarketContextValue>(
    () => ({ prices, binanceConnected, marketPrice, derived }),
    [prices, binanceConnected, marketPrice, derived],
  )

  // Slow slice — recreated only when account/positions/draft/manage actually change.
  const stateValue = useMemo<TradingStateValue>(
    () => ({
      activeSymbol,
      account,
      openPositions,
      pendingOrders,
      closedTrades,
      draft,
      selectedPositionId,
      managePositionId,
      manageSL,
      manageTP,
      accountId,
      isSubmitting,
      lastError,
    }),
    [
      activeSymbol,
      account,
      openPositions,
      pendingOrders,
      closedTrades,
      draft,
      selectedPositionId,
      managePositionId,
      manageSL,
      manageTP,
      accountId,
      isSubmitting,
      lastError,
    ],
  )

  // Stable slice — every dependency is a useCallback with an empty dep array, so
  // this object is created once and never changes identity.
  const actionsValue = useMemo<TradingActionsValue>(
    () => ({
      setActiveSymbol,
      setDraft,
      setSelectedPositionId,
      beginManage,
      endManage,
      setManageSL,
      setManageTP,
      pnlFor,
      executeOrder,
      closePosition,
      partialClose,
      modifyPosition,
      closeAllPositions,
      cancelPending,
      resetAccount,
      setAccountId,
    }),
    [
      setActiveSymbol,
      setDraft,
      setSelectedPositionId,
      beginManage,
      endManage,
      setManageSL,
      setManageTP,
      pnlFor,
      executeOrder,
      closePosition,
      partialClose,
      modifyPosition,
      closeAllPositions,
      cancelPending,
      resetAccount,
      setAccountId,
    ],
  )

  return (
    <TradingActionsContext.Provider value={actionsValue}>
      <TradingStateContext.Provider value={stateValue}>
        <MarketContext.Provider value={marketValue}>{children}</MarketContext.Provider>
      </TradingStateContext.Provider>
    </TradingActionsContext.Provider>
  )
}
