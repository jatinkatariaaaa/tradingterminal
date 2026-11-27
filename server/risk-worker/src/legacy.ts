// The risk loop exactly as it ran before engine v4, kept as the rollback path (RISK_ENGINE=legacy).
//
// Each tick, for every tradable account:
//   1. Fill any working pending order whose trigger has been crossed.
//   2. Apply SL/TP closes on open positions.
//   3. Recompute equity on the CLOSE side of the spread.
//   4. On a drawdown breach: force-close all positions (reason 'breach') then freeze + audit via
//      breach_account. Otherwise apply_risk_tick handles the 5pm ET daily rollover, highwater, and
//      profit-target detection.
//
// It reads accounts, positions and orders with three requests and calls apply_risk_tick once per
// tradable account, one after another, so a loop takes one database round trip per account.

import { ASSET_MAP, isMarketOpen } from "./assets.js"
import { breachFloor, marksFor, orderTriggered, slTpExit } from "./rules.js"
import type { AccountRow, CrmNotify, OrderRow, PositionRow, PriceFeed, PriceRow, RiskDb } from "./types.js"
import { commissionFor, computeEquity, grossPnlUsd, marginRequired, openFillPrice, spreadOf } from "./valuation.js"

const PUBLISH_EVERY_MS = 5000

export class LegacyEngine {
  private lastPublishedTime: Record<string, number> = {}

  constructor(
    private readonly db: RiskDb,
    private readonly feed: PriceFeed,
    private readonly notify: CrmNotify,
    private readonly clock: () => number = Date.now,
  ) {}

  /**
   * Publish the latest server prices into public.prices so the /api/trade routes can price market orders
   * (Option A). Throttled: each symbol at most once every 5 seconds. Never publishes a price that did not
   * come from a real feed, and nothing for a closed market.
   */
  async publishPrices(): Promise<void> {
    const prices = this.feed.all()
    const now = this.clock()
    const rows: PriceRow[] = []
    for (const [symbol, price] of Object.entries(prices)) {
      if (!Number.isFinite(price) || price <= 0) continue
      if (!this.feed.isReal(symbol)) continue
      const asset = ASSET_MAP[symbol]
      if (asset && !isMarketOpen(asset.category)) continue
      const lastTime = this.lastPublishedTime[symbol] ?? 0
      if (now - lastTime >= PUBLISH_EVERY_MS) {
        rows.push({ symbol, price, updated_at: new Date(now).toISOString() })
        this.lastPublishedTime[symbol] = now
      }
    }
    if (rows.length === 0) return
    try {
      await this.db.upsertPrices(rows)
    } catch (err) {
      // Non-fatal: the next tick retries. Log so price staleness is visible.
      console.warn("publishPrices failed:", (err as Error).message)
    }
  }

  private async tickAccount(account: AccountRow, positions: PositionRow[], orders: OrderRow[]): Promise<void> {
    const accountId = account.id
    const balance = account.balance
    const prices = this.feed.all()

    // 1) Fill triggered pending orders (genuine cross from the placed side).
    for (const o of orders) {
      const price = this.feed.get(o.symbol)
      const asset = ASSET_MAP[o.symbol]
      if (price == null || !asset) continue
      if (!orderTriggered(o, price)) continue
      const t = o.trigger_price
      const spread = spreadOf(asset, t)
      const entryFill = openFillPrice(o.direction, t, spread)
      const margin = marginRequired(asset, o.volume, entryFill, prices, Number(account.leverage) || 100)
      try {
        // fill_order is atomic and idempotent: it locks the order FOR UPDATE and no-ops unless still
        // 'working', so an order can NEVER open more than one position even if ticks overlap.
        await this.db.fillOrder({
          orderId: o.id,
          entryFill,
          contractSize: asset.contractSize,
          digits: asset.digits,
          margin,
          commission: commissionFor(o.volume),
        })
      } catch (err) {
        console.warn(`[order ${o.id}] fill skipped:`, (err as Error).message)
      }
    }

    // 2) SL/TP closes.
    const survivors: PositionRow[] = []
    for (const p of positions) {
      const mid = this.feed.get(p.symbol)
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
      await this.db.closePosition({
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

    // 4) Breach check: breach_account closes every position at the supplied marks, freezes and audits
    // atomically. Non-breach bookkeeping stays in apply_risk_tick.
    const floor = breachFloor(account)
    if (floor && equity <= floor.level) {
      await this.db.breachAccount({
        accountId,
        equity,
        kind: floor.kind,
        reason: floor.reason(equity),
        marks: marksFor(survivors, prices),
      })
      const breachedAccount = await this.db.fetchAccountSnapshot(accountId)
      await this.notify({
        login: accountId,
        terminal_account_id: accountId,
        current_balance: breachedAccount.balance,
        current_equity: breachedAccount.equity,
        status: "breached",
      })
      return
    }

    // No breach: let SQL update equity/highwater, roll the 5pm ET daily baseline, and detect the target.
    const oldStatus = account.status
    const newStatus = await this.db.applyRiskTick(accountId, equity)

    if (oldStatus !== "passed" && newStatus === "passed") {
      // Atomically close all positions and lock equity=balance.
      const passedAccount = await this.db.passAccount({ accountId, equity, marks: marksFor(survivors, prices) })
      await this.notify({
        login: accountId,
        terminal_account_id: accountId,
        current_balance: passedAccount.balance,
        current_equity: passedAccount.equity,
        status: "passed",
      })
    }
  }

  async tick(): Promise<void> {
    try {
      await this.publishPrices()
      const accounts = await this.db.fetchTradableAccounts()
      if (accounts.length === 0) return

      const accountIds = accounts.map((a) => a.id)
      const allPositions = await this.db.fetchAllPositions(accountIds)
      const allOrders = await this.db.fetchAllWorkingOrders(accountIds)

      const positionsByAccount: Record<string, PositionRow[]> = {}
      for (const p of allPositions) (positionsByAccount[p.account_id] ??= []).push(p)
      const ordersByAccount: Record<string, OrderRow[]> = {}
      for (const o of allOrders) (ordersByAccount[o.account_id] ??= []).push(o)

      for (const a of accounts) {
        try {
          await this.tickAccount(a, positionsByAccount[a.id] || [], ordersByAccount[a.id] || [])
        } catch (err) {
          console.error(`[account ${a.id}] tick error:`, (err as Error).message)
        }
      }
    } catch (err) {
      console.error("tick fatal:", (err as Error).message)
    }
  }

  /** Serialized loop: never overlap DB work if a tick runs long. */
  start(tickMs: number): void {
    let running = false
    setInterval(() => {
      if (running) return
      running = true
      void this.tick().finally(() => {
        running = false
      })
    }, tickMs)
  }
}
