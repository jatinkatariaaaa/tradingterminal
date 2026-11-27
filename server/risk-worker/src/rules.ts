// Trading rules shared by the v4 engine and the legacy loop. Pure functions: no I/O, no clock.
// Kept exactly as the worker applied them before engine v4.

import type { AccountRow, BreachMark, OrderRow, PositionRow } from "./types.js"
import { markPosition } from "./valuation.js"

/** SL/TP exit level for a position given the live mid, or null if untouched. */
export function slTpExit(p: PositionRow, mid: number): { exit: number; reason: "tp" | "sl" } | null {
  if (p.direction === "buy") {
    if (p.take_profit != null && mid >= p.take_profit) return { exit: p.take_profit, reason: "tp" }
    if (p.stop_loss != null && mid <= p.stop_loss) return { exit: p.stop_loss, reason: "sl" }
  } else {
    if (p.take_profit != null && mid <= p.take_profit) return { exit: p.take_profit, reason: "tp" }
    if (p.stop_loss != null && mid >= p.stop_loss) return { exit: p.stop_loss, reason: "sl" }
  }
  return null
}

/** A working pending order whose trigger has genuinely been crossed from the side it was placed on. */
export function orderTriggered(o: OrderRow, price: number): boolean {
  const t = o.trigger_price
  const ref = o.placed_price
  return (
    (o.kind === "limit" && o.direction === "buy" && ref > t && price <= t) ||
    (o.kind === "limit" && o.direction === "sell" && ref < t && price >= t) ||
    (o.kind === "stop" && o.direction === "buy" && ref < t && price >= t) ||
    (o.kind === "stop" && o.direction === "sell" && ref > t && price <= t)
  )
}

export interface BreachFloor {
  level: number
  kind: "daily_breach" | "overall_breach"
  reason: (eq: number) => string
}

/**
 * The breach floor an account's equity has crossed, if any. Mirrors the SQL in apply_risk_tick so the
 * worker can decide before calling breach_account. The higher floor wins, so a 5% daily limit breaches
 * before a 10% overall limit on a normal account.
 */
export function breachFloor(a: AccountRow): BreachFloor {
  const overall = a.starting_balance * (1 - a.max_overall_drawdown)
  const daily = a.daily_start_balance * (1 - a.max_daily_drawdown)
  return {
    level: Math.max(overall, daily),
    kind: overall >= daily ? "overall_breach" : "daily_breach",
    reason: (eq) =>
      overall >= daily
        ? `Overall drawdown breached: equity ${eq.toFixed(2)} <= floor ${overall.toFixed(2)}`
        : `Daily drawdown breached: equity ${eq.toFixed(2)} <= floor ${daily.toFixed(2)}`,
  }
}

/** Equity at which apply_risk_tick passes a challenge account, or null when the account has no target. */
export function targetEquity(a: AccountRow): number | null {
  if (a.phase !== "challenge" || a.status !== "active" || !(a.profit_target > 0)) return null
  return a.starting_balance * (1 + a.profit_target)
}

/** Close-side marks for every position that has a live price (breach_account / pass_account input). */
export function marksFor(positions: PositionRow[], prices: Record<string, number>): BreachMark[] {
  const marks: BreachMark[] = []
  for (const p of positions) {
    const m = markPosition(
      { symbol: p.symbol, direction: p.direction, volume: p.volume, openPrice: p.open_price, contractSize: p.contract_size },
      prices,
    )
    if (!m) continue // no live price: SQL closes it flat at open price
    marks.push({ position_id: p.id, exit_fill: m.exitFill, gross_pnl: m.grossPnl, commission: m.commission })
  }
  return marks
}

/**
 * The value a numeric(18,2) column stores for this equity, exactly as Postgres computes it: the worker
 * sends the number as JSON text (the shortest decimal that round-trips, which is what String() gives) and
 * Postgres rounds that decimal half away from zero. Working on the text avoids binary floating point, so
 * the worker skips a write exactly when the database would store the same value.
 */
export function storedCents(x: number): number {
  const s = String(x)
  if (!Number.isFinite(x) || /e/i.test(s)) return Math.round(x * 100) / 100
  const negative = s.startsWith("-")
  const [whole, fraction = ""] = (negative ? s.slice(1) : s).split(".")
  if (fraction.length <= 2) return x
  let cents = BigInt(whole + fraction.slice(0, 2))
  if (fraction[2]! >= "5") cents += 1n
  const value = Number(cents) / 100
  return negative && value !== 0 ? -value : value
}
