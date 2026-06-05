// Risk worker entrypoint (Phase 3, Step 3a skeleton).
//
// Each tick, for every tradable account:
//   1. Fill any working pending order whose trigger has been crossed.
//   2. Apply SL/TP closes on open positions.
//   3. Recompute equity on the CLOSE side of the spread.
//   4. On a drawdown breach: force-close all positions (reason 'breach') then
//      freeze + audit via apply_risk_tick. Otherwise apply_risk_tick handles the
//      5pm ET daily rollover, highwater, and profit-target detection.
//
// This is a SKELETON: it wires real ingestion + the SECURITY DEFINER writes, but
// does NOT touch the client. The browser TradingProvider keeps running until the
// Step 3b cutover. Pending-order fill and SL/TP detection mirror the client's
// logic; review carefully before relying on it in production.

import "./preload.js"
import { ASSET_MAP, getPrice, getPrices, startIngestion } from "./prices.js"
import { publishPrices } from "./publish-prices.js"
import {
  fetchTradableAccounts,
  fetchPositions,
  fetchWorkingOrders,
  rpcApplyRiskTick,
  rpcBreachAccount,
  rpcClosePosition,
  rpcFillOrder,
  type AccountRow,
  type BreachMark,
  type PositionRow,
} from "./db.js"
import {
  closeFillPrice,
  commissionFor,
  computeEquity,
  grossPnlUsd,
  marginRequired,
  markPosition,
  openFillPrice,
  spreadOf,
} from "./valuation.js"

const TICK_MS = Number(process.env.RISK_TICK_MS ?? "500")
const FX_POLL_MS = Number(process.env.FINNHUB_POLL_MS ?? process.env.FX_POLL_MS ?? "15000")

/** SL/TP exit level for a position given the live mid, or null if untouched. */
function slTpExit(p: PositionRow, mid: number): { exit: number; reason: "tp" | "sl" } | null {
  if (p.direction === "buy") {
    if (p.take_profit != null && mid >= p.take_profit) return { exit: p.take_profit, reason: "tp" }
    if (p.stop_loss != null && mid <= p.stop_loss) return { exit: p.stop_loss, reason: "sl" }
  } else {
    if (p.take_profit != null && mid <= p.take_profit) return { exit: p.take_profit, reason: "tp" }
    if (p.stop_loss != null && mid >= p.stop_loss) return { exit: p.stop_loss, reason: "sl" }
  }
  return null
}

async function tickAccount(accountId: string, account: AccountRow): Promise<void> {
  const balance = account.balance
  const prices = getPrices()
  const positions = await fetchPositions(accountId)
  const orders = await fetchWorkingOrders(accountId)

  // 1) Fill triggered pending orders (genuine cross from the placed side).
  for (const o of orders) {
    const price = getPrice(o.symbol)
    const asset = ASSET_MAP[o.symbol]
    if (price == null || !asset) continue
    const t = o.trigger_price
    const ref = o.placed_price
    const hit =
      (o.kind === "limit" && o.direction === "buy" && ref > t && price <= t) ||
      (o.kind === "limit" && o.direction === "sell" && ref < t && price >= t) ||
      (o.kind === "stop" && o.direction === "buy" && ref < t && price >= t) ||
      (o.kind === "stop" && o.direction === "sell" && ref > t && price <= t)
    if (!hit) continue
    const spread = spreadOf(asset, t)
    const entryFill = openFillPrice(o.direction, t, spread)
    const margin = marginRequired(asset, o.volume, entryFill, prices)
    try {
      // fill_order is atomic and idempotent: it locks the order FOR UPDATE and
      // no-ops unless still 'working', so an order can NEVER open more than one
      // position even if ticks overlap. SL/TP carry over from the order itself.
      await rpcFillOrder({
        orderId: o.id,
        entryFill,
        contractSize: asset.contractSize,
        digits: asset.digits,
        margin,
        commission: commissionFor(o.volume),
      })
    } catch (err) {
      // Unexpected DB error — leave the order working for a later tick.
      console.warn(`[order ${o.id}] fill skipped:`, (err as Error).message)
    }
  }

  // 2) SL/TP closes.
  const survivors: PositionRow[] = []
  for (const p of positions) {
    const mid = getPrice(p.symbol)
    if (mid == null) {
      survivors.push(p)
      continue
    }
    const hit = slTpExit(p, mid)
    if (!hit) {
      survivors.push(p)
      continue
    }
    const pos = { symbol: p.symbol, direction: p.direction, volume: p.volume, openPrice: p.open_price, contractSize: p.contract_size }
    const gross = grossPnlUsd(pos, hit.exit, prices)
    await rpcClosePosition({
      positionId: p.id,
      exitFill: hit.exit,
      grossPnl: gross,
      commission: commissionFor(p.volume),
      reason: hit.reason,
    })
  }

  // 3) Equity on the close side from the survivors.
  const valued = survivors.map((p) => ({
    symbol: p.symbol,
    direction: p.direction,
    volume: p.volume,
    openPrice: p.open_price,
    contractSize: p.contract_size,
  }))
  const equity = computeEquity(balance, valued, prices)

  // 4) Breach check. The worker owns the close-side equity, so it decides the
  // breach here and calls breach_account ONCE — which closes every position at
  // the supplied marks, freezes, and audits atomically (no freeze-then-loop
  // window). Non-breach bookkeeping (equity/highwater, 5pm ET rollover, profit
  // target) stays in apply_risk_tick.
  const floor = breachFloor(account)
  if (floor && equity <= floor.level) {
    const marks: BreachMark[] = []
    for (const p of survivors) {
      const m = markPosition(
        { symbol: p.symbol, direction: p.direction, volume: p.volume, openPrice: p.open_price, contractSize: p.contract_size },
        prices,
      )
      if (!m) continue // no live price — SQL closes it flat at open price
      marks.push({ position_id: p.id, exit_fill: m.exitFill, gross_pnl: m.grossPnl, commission: m.commission })
    }
    await rpcBreachAccount({
      accountId,
      equity,
      kind: floor.kind,
      reason: floor.reason(equity),
      marks,
    })
    return
  }

  // No breach: let SQL update equity/highwater, roll the 5pm ET daily baseline,
  // and detect the profit target.
  await rpcApplyRiskTick(accountId, equity)
}

/**
 * The breach floor an account's equity has crossed, if any. Mirrors the SQL in
 * apply_risk_tick so the worker can decide before calling breach_account.
 * Overall drawdown is checked first (it is the harder limit).
 */
function breachFloor(
  a: AccountRow,
): { level: number; kind: "daily_breach" | "overall_breach"; reason: (eq: number) => string } | null {
  const overall = a.starting_balance * (1 - a.max_overall_drawdown)
  const daily = a.daily_start_balance * (1 - a.max_daily_drawdown)
  // Return the higher (closer) floor's identity, but breach if EITHER is hit.
  return {
    level: Math.max(overall, daily),
    kind: overall >= daily ? "overall_breach" : "daily_breach",
    reason: (eq) =>
      overall >= daily
        ? `Overall drawdown breached: equity ${eq.toFixed(2)} <= floor ${overall.toFixed(2)}`
        : `Daily drawdown breached: equity ${eq.toFixed(2)} <= floor ${daily.toFixed(2)}`,
  }
}

async function tick(): Promise<void> {
  try {
    // Publish the latest server prices first so the /api/trade routes can price
    // market orders from public.prices (Option A fill-price model).
    await publishPrices()
    const accounts = await fetchTradableAccounts()
    for (const a of accounts) {
      try {
        await tickAccount(a.id, a)
      } catch (err) {
        console.error(`[account ${a.id}] tick error:`, (err as Error).message)
      }
    }
  } catch (err) {
    console.error("tick fatal:", (err as Error).message)
  }
}

async function main(): Promise<void> {
  console.log("risk-worker: starting ingestion\u2026")
  await startIngestion(FX_POLL_MS)
  console.log(`risk-worker: ingestion ready, ticking every ${TICK_MS}ms`)
  // Serialize ticks: never overlap DB work if a tick runs long.
  let running = false
  setInterval(() => {
    if (running) return
    running = true
    void tick().finally(() => {
      running = false
    })
  }, TICK_MS)
}

void main()
