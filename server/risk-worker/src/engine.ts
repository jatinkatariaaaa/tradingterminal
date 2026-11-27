// Risk engine v4: the same rules as the legacy loop, evaluated in memory on every tick, with the database
// touched only when something has to change.
//
// Every tick (RISK_TICK_MS, 500 ms by default) the engine marks every tradable account on the live feed,
// on the close side of the spread, and applies the rules in the same order as before:
//   1. fill working pending orders whose trigger was crossed (fill_order),
//   2. close positions at their SL/TP level (close_position),
//   3. breach an account whose equity is at or under its floor (breach_account, then the CRM webhook),
//   4. hand an account whose equity reached its profit target to SQL at once (apply_risk_tick's rules
//      decide, min trading days included), then pass_account and the CRM webhook.
// Those events go to the database the moment they happen.
//
// Everything else rides on one request per cycle, risk_cycle (RISK_CYCLE_MS, 2 s by default while any
// position or order is open, RISK_IDLE_CYCLE_MS while the book is flat): the equity of every account
// whose stored value would change, the 5pm New York roll when due, and the prices for the trade routes.
// The same request returns the account, position and order snapshot, but only the parts that changed.
//
// After an event, the account is not marked again until a fresh snapshot is in, and the engine fetches
// that snapshot straight away. So it never trades on a balance or position list it has just changed.

import { ASSET_MAP, isMarketOpen } from "./assets.js"
import { breachFloor, marksFor, orderTriggered, slTpExit, storedCents, targetEquity } from "./rules.js"
import type {
  AccountRow, CrmNotify, CycleResult, CycleTick, Fingerprints, OrderRow, PositionRow, PriceFeed, PriceRow, RiskDb,
} from "./types.js"
import { commissionFor, computeEquity, grossPnlUsd, marginRequired, openFillPrice, spreadOf } from "./valuation.js"

export interface EngineConfig {
  /** In-memory marking cadence. */
  tickMs: number
  /** Snapshot cadence while any position or order is open (how fast a new position or order is picked up). */
  cycleMs: number
  /**
   * How often equity is written. Every write of a cycle (equity, prices) shares one transaction, so the
   * database commits at most once per persistMs plus the trading events themselves.
   */
  persistMs: number
  /** Snapshot cadence while no tradable account has a position or a working order. */
  idleCycleMs: number
  /** A changed price is republished at most this often (the trade routes fill market orders from public.prices). */
  priceMs: number
  /** An unchanged price is still republished this often; open_market_position rejects prices older than 60 s. */
  priceRefreshMs: number
  /** The whole snapshot is resent this often, as a safety net for changes no fingerprint covers. */
  fullRefreshMs: number
  /** How soon to recheck a reached profit target that min trading days held back. */
  targetRetryMs: number
  /** Retry spacing for a pending fill that no-op'd (not enough margin) or an event call that failed. */
  retryMs: number
  /** Accounts marked in parallel when events need database calls. */
  concurrency: number
  /**
   * Most equity writes in one cycle. A cycle's writes share a transaction, so this bounds how long its row
   * locks are held on a large book; forced ticks go first and the rest follow in the next cycle.
   */
  maxTicks: number
}

export const DEFAULT_CONFIG: EngineConfig = {
  tickMs: 500,
  cycleMs: 2000,
  persistMs: 5000,
  idleCycleMs: 4000,
  priceMs: 5000,
  priceRefreshMs: 30_000,
  fullRefreshMs: 300_000,
  targetRetryMs: 10_000,
  retryMs: 2000,
  concurrency: 4,
  maxTicks: 250,
}

export function configFromEnv(env: NodeJS.ProcessEnv): EngineConfig {
  const num = (name: string, fallback: number, min: number) => {
    const v = Number(env[name])
    return Number.isFinite(v) && v >= min ? v : fallback
  }
  return {
    tickMs: num("RISK_TICK_MS", DEFAULT_CONFIG.tickMs, 50),
    cycleMs: num("RISK_CYCLE_MS", DEFAULT_CONFIG.cycleMs, 250),
    persistMs: num("RISK_PERSIST_MS", DEFAULT_CONFIG.persistMs, 250),
    idleCycleMs: num("RISK_IDLE_CYCLE_MS", DEFAULT_CONFIG.idleCycleMs, 250),
    priceMs: num("PRICE_PUBLISH_MS", DEFAULT_CONFIG.priceMs, 250),
    priceRefreshMs: num("PRICE_REFRESH_MS", DEFAULT_CONFIG.priceRefreshMs, 1000),
    fullRefreshMs: num("RISK_FULL_REFRESH_MS", DEFAULT_CONFIG.fullRefreshMs, 5000),
    targetRetryMs: num("RISK_TARGET_RETRY_MS", DEFAULT_CONFIG.targetRetryMs, 250),
    retryMs: num("RISK_RETRY_MS", DEFAULT_CONFIG.retryMs, 100),
    concurrency: Math.floor(num("RISK_CONCURRENCY", DEFAULT_CONFIG.concurrency, 1)),
    maxTicks: Math.floor(num("RISK_MAX_TICKS", DEFAULT_CONFIG.maxTicks, 1)),
  }
}

/** risk_cycle is not in the database yet (migration not applied): the worker falls back to the legacy loop. */
export class MissingCycleRpc extends Error {}

function isMissingFunction(err: unknown): boolean {
  const e = err as { code?: string; message?: string }
  return e?.code === "PGRST202" || e?.code === "42883" || /could not find the function/i.test(e?.message ?? "")
}

interface Stored {
  equity: number | null
  highest: number | null
}

interface PendingPass {
  equity: number
  positions: PositionRow[]
  retryAt: number
}

const num = (v: unknown): number | null => (v == null ? null : Number(v))

export class RiskEngine {
  // Snapshot the engine trades on.
  private accounts = new Map<string, AccountRow>()
  private positions = new Map<string, PositionRow[]>()
  private orders = new Map<string, OrderRow[]>()
  private fp: Fingerprints = {}
  private loaded = false

  // What the database stores for each account, from snapshots and tick results.
  private stored = new Map<string, Stored>()
  private mark = new Map<string, number>()
  private peak = new Map<string, number>()
  private forced = new Set<string>()
  private targetRetryAt = new Map<string, number>()
  private retryAt = new Map<string, number>()
  private stale = new Set<string>()
  private dueReset = new Set<string>()
  private nextResetAt = Number.POSITIVE_INFINITY
  private resetForcedFor = Number.NaN
  private pendingPass = new Map<string, PendingPass>()
  private lastCycleAt = Number.NEGATIVE_INFINITY
  private lastWriteAt = Number.NEGATIVE_INFINITY
  private backlog = false
  private lastFullAt = Number.NEGATIVE_INFINITY
  private wantCycle = false

  // Prices already published.
  private pubAt: Record<string, number> = {}
  private pubPrice: Record<string, number> = {}

  readonly stats = { cycles: 0, ticksSent: 0, pricesSent: 0, events: 0, errors: 0 }

  constructor(
    private readonly db: RiskDb,
    private readonly feed: PriceFeed,
    private readonly notify: CrmNotify,
    private readonly cfg: EngineConfig = DEFAULT_CONFIG,
    private readonly clock: () => number = Date.now,
  ) {}

  /** One pass: mark every account, act on the rules, and run a cycle when one is due. */
  async step(): Promise<void> {
    if (!this.loaded) {
      await this.cycle(this.clock())
      if (!this.loaded) return
    }
    await this.retryPasses(this.clock())
    // An event refreshes the snapshot at once and the account is marked again on it, in the same step.
    for (let round = 0; round < 3; round++) {
      const events = await this.evaluate(this.clock())
      if (this.cycleDue(this.clock())) await this.cycle(this.clock())
      if (events === 0) break
    }
  }

  /** Sends every pending mark and returns once the database has it (used on shutdown and by tests). */
  async flush(): Promise<void> {
    for (const id of this.accounts.keys()) if (this.mark.has(id)) this.forced.add(id)
    await this.cycle(this.clock())
  }

  /** Runs the loop until the process exits. */
  async run(): Promise<never> {
    for (;;) {
      const started = this.clock()
      try {
        await this.step()
      } catch (err) {
        if (err instanceof MissingCycleRpc) throw err
        this.stats.errors++
        console.error("risk step failed:", (err as Error).message)
      }
      const wait = Math.max(0, this.cfg.tickMs - (this.clock() - started))
      await new Promise((resolve) => setTimeout(resolve, wait))
    }
  }

  // ------------------------------------------------------------------ marking and events

  private async evaluate(now: number): Promise<number> {
    if (now >= this.nextResetAt && this.resetForcedFor !== this.nextResetAt) {
      // 5pm New York: every tradable account rolls its daily baseline in the next cycle.
      for (const id of this.accounts.keys()) this.forced.add(id)
      this.resetForcedFor = this.nextResetAt
    }
    for (const id of this.dueReset) this.forced.add(id)

    const prices = this.feed.all()
    let events = 0
    const queue = [...this.accounts.values()].filter((a) => !this.stale.has(a.id))
    const worker = async () => {
      for (let a = queue.shift(); a; a = queue.shift()) events += await this.evaluateAccount(a, prices, now)
    }
    await Promise.all(Array.from({ length: Math.max(1, this.cfg.concurrency) }, worker))
    return events
  }

  /** Marks one account and fires its events. Returns how many database events it caused. */
  private async evaluateAccount(a: AccountRow, prices: Record<string, number>, now: number): Promise<number> {
    const positions = this.positions.get(a.id) ?? []
    const orders = this.orders.get(a.id) ?? []
    let events = 0

    // 1) Pending orders: same trigger rule and fill inputs as before.
    for (const o of orders) {
      const price = this.feed.get(o.symbol)
      const asset = ASSET_MAP[o.symbol]
      if (price == null || !asset || !orderTriggered(o, price)) continue
      if (now < (this.retryAt.get(o.id) ?? 0)) continue
      const spread = spreadOf(asset, o.trigger_price)
      const entryFill = openFillPrice(o.direction, o.trigger_price, spread)
      const margin = marginRequired(asset, o.volume, entryFill, prices, Number(a.leverage) || 100)
      try {
        // fill_order locks the order and no-ops unless it is still working: one position per order, always.
        const filled = await this.db.fillOrder({
          orderId: o.id, entryFill, contractSize: asset.contractSize, digits: asset.digits, margin,
          commission: commissionFor(o.volume),
        })
        if (filled) events++
        else this.retryAt.set(o.id, now + this.cfg.retryMs) // not enough free margin yet: try again shortly
      } catch (err) {
        this.stats.errors++
        this.retryAt.set(o.id, now + this.cfg.retryMs)
        console.warn(`[order ${o.id}] fill skipped:`, (err as Error).message)
      }
    }

    // 2) SL/TP: closed at the level itself, as before.
    const survivors: PositionRow[] = []
    for (const p of positions) {
      const mid = this.feed.get(p.symbol)
      const hit = mid == null ? null : slTpExit(p, mid)
      if (!hit) {
        survivors.push(p)
        continue
      }
      if (now < (this.retryAt.get(p.id) ?? 0)) {
        survivors.push(p)
        continue
      }
      const gross = grossPnlUsd(
        { symbol: p.symbol, direction: p.direction, volume: p.volume, openPrice: p.open_price, contractSize: p.contract_size },
        hit.exit, prices)
      try {
        await this.db.closePosition({ positionId: p.id, exitFill: hit.exit, grossPnl: gross, commission: commissionFor(p.volume), reason: hit.reason })
      } catch (err) {
        // Usually already closed by the trader; the fresh snapshot settles it either way.
        this.stats.errors++
        this.retryAt.set(p.id, now + this.cfg.retryMs)
        console.warn(`[position ${p.id}] ${hit.reason} close failed:`, (err as Error).message)
      }
      events++
    }

    if (events > 0) {
      // The balance or the positions changed: mark this account again on a fresh snapshot.
      this.stats.events += events
      this.stale.add(a.id)
      this.wantCycle = true
      return events
    }

    // 3) Equity on the close side of the spread.
    const equity = computeEquity(
      a.balance,
      survivors.map((p) => ({ symbol: p.symbol, direction: p.direction, volume: p.volume, openPrice: p.open_price, contractSize: p.contract_size })),
      prices,
    )
    if (!Number.isFinite(equity)) {
      console.warn(`[account ${a.id}] skipped a mark: equity is not a number`)
      return 0
    }

    // 4) Breach: decided here on the worker's close-side equity, exactly as before.
    const floor = breachFloor(a)
    if (equity <= floor.level) {
      // Under the floor the account is never marked or persisted as if it were fine: like the legacy loop,
      // it waits for breach_account to go through (retried shortly if the call failed).
      if (now < (this.retryAt.get(`breach:${a.id}`) ?? 0)) return 0
      try {
        await this.db.breachAccount({ accountId: a.id, equity, kind: floor.kind, reason: floor.reason(equity), marks: marksFor(survivors, prices) })
      } catch (err) {
        this.stats.errors++
        this.retryAt.set(`breach:${a.id}`, now + this.cfg.retryMs)
        console.error(`[account ${a.id}] breach failed, will retry:`, (err as Error).message)
        return 0
      }
      this.stats.events++
      this.stale.add(a.id)
      this.wantCycle = true
      // The CRM hears about it without holding up the loop.
      void this.db.fetchAccountSnapshot(a.id)
        .then((s) => this.notify({ login: a.id, terminal_account_id: a.id, current_balance: s.balance, current_equity: s.equity, status: "breached" }))
        .catch((err) => console.error(`[account ${a.id}] breach webhook failed:`, (err as Error).message))
      return 1
    }

    this.mark.set(a.id, equity)
    this.peak.set(a.id, Math.max(this.peak.get(a.id) ?? equity, equity))

    // 5) Profit target: SQL decides at once (it checks min trading days).
    const target = targetEquity(a)
    if (target != null && equity >= target && now >= (this.targetRetryAt.get(a.id) ?? 0)) this.forced.add(a.id)
    return 0
  }

  /** The database would store a different equity or high-water mark (private.risk_tick's write rule). */
  private needsWrite(id: string, equity: number): boolean {
    const s = this.stored.get(id)
    if (!s || s.equity == null) return true
    if (storedCents(equity) !== s.equity) return true
    if (s.highest == null) return equity !== s.equity // the high-water mark is filled in on any change
    return storedCents(Math.max(this.peak.get(id) ?? equity, equity)) > s.highest
  }

  private bookFlat(): boolean {
    for (const list of this.positions.values()) if (list.length) return false
    for (const list of this.orders.values()) if (list.length) return false
    return true
  }

  private cycleDue(now: number): boolean {
    if (this.wantCycle) return true
    for (const id of this.forced) if (this.accounts.has(id) && this.mark.has(id) && !this.stale.has(id)) return true
    return now - this.lastCycleAt >= (this.bookFlat() ? this.cfg.idleCycleMs : this.cfg.cycleMs)
  }

  // ------------------------------------------------------------------ the one request per cycle

  private duePrices(now: number): PriceRow[] {
    const rows: PriceRow[] = []
    for (const [symbol, price] of Object.entries(this.feed.all())) {
      if (!Number.isFinite(price) || price <= 0) continue
      // Never a fallback price: only what a real feed delivered, and nothing for a closed market.
      if (!this.feed.isReal(symbol)) continue
      const asset = ASSET_MAP[symbol]
      if (asset && !isMarketOpen(asset.category)) continue
      const age = now - (this.pubAt[symbol] ?? Number.NEGATIVE_INFINITY)
      const changed = this.pubPrice[symbol] !== price
      if ((changed && age >= this.cfg.priceMs) || age >= this.cfg.priceRefreshMs) {
        rows.push({ symbol, price, updated_at: new Date(now).toISOString() })
      }
    }
    return rows
  }

  private async cycle(now: number): Promise<void> {
    const prices = this.duePrices(now)
    const candidates: { a: AccountRow; equity: number; forced: boolean }[] = []
    for (const a of this.accounts.values()) {
      if (this.stale.has(a.id)) continue
      if (now < (this.retryAt.get(`tick:${a.id}`) ?? 0)) continue
      const equity = this.mark.get(a.id)
      if (equity === undefined) continue
      const forced = this.forced.has(a.id)
      if (forced || this.needsWrite(a.id, equity)) candidates.push({ a, equity, forced })
    }
    // Writes are batched: equity goes out every persistMs, or with anything else this cycle already writes
    // (a due price, a forced tick), so the cycle commits once. Otherwise the cycle is a read-only snapshot.
    const writing =
      this.backlog || prices.length > 0 || candidates.some((c) => c.forced) || now - this.lastWriteAt >= this.cfg.persistMs
    candidates.sort((x, y) => Number(y.forced) - Number(x.forced))
    const ticks: CycleTick[] = []
    for (const c of candidates) {
      if (!c.forced && !writing) continue
      if (ticks.length >= this.cfg.maxTicks) break
      ticks.push({ id: c.a.id, equity: c.equity, peak: Math.max(this.peak.get(c.a.id) ?? c.equity, c.equity) })
    }
    const backlog = writing && ticks.length < candidates.length
    const full = !this.loaded || now - this.lastFullAt >= this.cfg.fullRefreshMs
    const before = new Map(this.positions)

    let res: CycleResult
    try {
      res = await this.db.riskCycle(ticks, prices, full ? {} : this.fp)
    } catch (err) {
      if (isMissingFunction(err)) throw new MissingCycleRpc("risk_cycle is not deployed")
      this.stats.errors++
      this.lastCycleAt = now
      this.wantCycle = false
      console.error("risk_cycle failed:", (err as Error).message)
      return
    }

    this.stats.cycles++
    this.stats.ticksSent += ticks.length
    this.stats.pricesSent += prices.length
    this.lastCycleAt = now
    if (ticks.length > 0 || prices.length > 0) this.lastWriteAt = now
    // More dirty accounts than one cycle may write: the next cycle writes the rest without waiting.
    this.backlog = backlog
    this.wantCycle = backlog
    if (full) this.lastFullAt = now
    for (const p of prices) {
      this.pubAt[p.symbol] = now
      this.pubPrice[p.symbol] = p.price
    }

    const sent = new Map(ticks.map((t) => [t.id, t]))
    const passed: string[] = []
    for (const r of res.ticks ?? []) {
      const t = sent.get(r.id)
      if (!t) continue
      if (r.error) {
        this.stats.errors++
        this.forced.delete(r.id)
        this.retryAt.set(`tick:${r.id}`, now + this.cfg.retryMs)
        console.warn(`[account ${r.id}] tick failed:`, r.error)
        continue // still dirty: sent again after retryMs
      }
      this.stored.set(r.id, { equity: num(r.equity), highest: num(r.highest_equity) })
      this.peak.set(r.id, t.equity)
      this.forced.delete(r.id)
      this.dueReset.delete(r.id)
      const acct = this.accounts.get(r.id)
      if (r.status === "passed" && acct?.status !== "passed") {
        passed.push(r.id)
      } else if (acct) {
        const target = targetEquity(acct)
        if (target != null && t.equity >= target) this.targetRetryAt.set(r.id, now + this.cfg.targetRetryMs)
      }
    }

    this.applySnapshot(res)

    // Target reached and confirmed by SQL: close everything at the marks and lock equity = balance.
    for (const id of passed) {
      const equity = sent.get(id)!.equity
      this.pendingPass.set(id, { equity, positions: before.get(id) ?? [], retryAt: now })
    }
    if (passed.length) await this.retryPasses(now)
  }

  private applySnapshot(res: CycleResult): void {
    if (res.accounts) {
      const next = new Map<string, AccountRow>()
      for (const a of res.accounts) {
        const row: AccountRow = {
          ...a,
          balance: Number(a.balance), equity: Number(a.equity), starting_balance: Number(a.starting_balance),
          daily_start_balance: Number(a.daily_start_balance), max_daily_drawdown: Number(a.max_daily_drawdown),
          max_overall_drawdown: Number(a.max_overall_drawdown), profit_target: Number(a.profit_target),
          leverage: Number(a.leverage), highest_equity: num(a.highest_equity), min_trading_days: num(a.min_trading_days),
        }
        next.set(row.id, row)
        this.stored.set(row.id, { equity: num(a.equity), highest: num(a.highest_equity) })
      }
      for (const id of this.accounts.keys()) {
        if (next.has(id)) continue
        // Left the tradable set (breached, passed, suspended): forget its bookkeeping.
        for (const m of [this.stored, this.mark, this.peak, this.targetRetryAt]) m.delete(id)
        this.forced.delete(id)
      }
      this.accounts = next
    }
    if (res.positions) {
      const next = new Map<string, PositionRow[]>()
      for (const p of res.positions) {
        const row: PositionRow = {
          ...p,
          volume: Number(p.volume), open_price: Number(p.open_price), contract_size: Number(p.contract_size),
          digits: Number(p.digits), stop_loss: num(p.stop_loss), take_profit: num(p.take_profit),
          commission: Number(p.commission), margin: Number(p.margin),
        }
        const list = next.get(row.account_id) ?? []
        list.push(row)
        next.set(row.account_id, list)
      }
      this.positions = next
    }
    if (res.orders) {
      const next = new Map<string, OrderRow[]>()
      for (const o of res.orders) {
        const row: OrderRow = {
          ...o,
          volume: Number(o.volume), trigger_price: Number(o.trigger_price), placed_price: Number(o.placed_price),
          stop_loss: num(o.stop_loss), take_profit: num(o.take_profit),
        }
        const list = next.get(row.account_id) ?? []
        list.push(row)
        next.set(row.account_id, list)
      }
      this.orders = next
    }
    this.fp = res.fp
    this.nextResetAt = Date.parse(res.next_daily_reset_at)
    this.dueReset = new Set(res.due_daily_reset ?? [])
    this.stale.clear()
    this.loaded = true
  }

  private async retryPasses(now: number): Promise<void> {
    for (const [id, p] of this.pendingPass) {
      if (now < p.retryAt) continue
      try {
        const acct = await this.db.passAccount({ accountId: id, equity: p.equity, marks: marksFor(p.positions, this.feed.all()) })
        this.pendingPass.delete(id)
        this.stats.events++
        void this.notify({ login: id, terminal_account_id: id, current_balance: acct.balance, current_equity: acct.equity, status: "passed" })
          .catch((err) => console.error(`[account ${id}] pass webhook failed:`, (err as Error).message))
      } catch (err) {
        this.stats.errors++
        p.retryAt = now + this.cfg.retryMs
        console.error(`[account ${id}] pass_account failed, will retry:`, (err as Error).message)
      }
    }
  }
}
