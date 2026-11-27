// Engine v4 against the legacy loop, end to end, on real SQL.
//
// Each simulation builds two identical databases (PGlite, PostgreSQL 17) with the live schema, the live
// trading functions and the engine v4 migration, seeds the same accounts, positions and orders, then
// drives the legacy loop on one and engine v4 on the other through the same seeded price path, one tick
// per step. At the end every trade, account event, balance, status, equity and high-water mark is
// compared.
//
// Run: npm test   (from server/risk-worker)

import { test } from "node:test"
import assert from "node:assert/strict"
import type { PGlite } from "@electric-sql/pglite"
import { openDb, pgRiskDb } from "./pg-db.js"
import { LegacyEngine } from "../src/legacy.js"
import { DEFAULT_CONFIG, RiskEngine, type EngineConfig } from "../src/engine.js"
import { storedCents } from "../src/rules.js"
import type { CrmNotify, PriceFeed } from "../src/types.js"

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
type Rng = ReturnType<typeof rng>
const pick = <T>(r: Rng, list: T[]): T => list[Math.floor(r() * list.length)]!
const uuid = (r: Rng) => {
  const s = Array.from({ length: 32 }, () => Math.floor(r() * 16).toString(16)).join("")
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-a${s.slice(17, 20)}-${s.slice(20, 32)}`
}
const r2 = (x: number) => Math.round(x * 100) / 100

class Feed implements PriceFeed {
  prices: Record<string, number> = {}
  get(symbol: string) { return this.prices[symbol] }
  all() { return { ...this.prices } }
  isReal() { return true }
}

// USD-quoted symbols only, so a P&L never depends on a conversion rate that moved between two steps.
const SYMBOLS: Record<string, { price: number; vol: number; contract: number; digits: number }> = {
  "BTC/USD": { price: 73000, vol: 0.0015, contract: 1, digits: 2 },
  "ETH/USD": { price: 2700, vol: 0.002, contract: 1, digits: 2 },
  XAUUSD: { price: 4495, vol: 0.0007, contract: 100, digits: 2 },
  EURUSD: { price: 1.144, vol: 0.0004, contract: 100_000, digits: 5 },
}

function walk(r: Rng, feed: Feed) {
  for (const [s, m] of Object.entries(SYMBOLS)) {
    const prev = feed.prices[s] ?? m.price
    const z = (r() + r() + r() - 1.5) * 2 // roughly normal
    feed.prices[s] = Number((prev * (1 + m.vol * z)).toFixed(m.digits === 5 ? 5 : 2))
  }
}

interface Book {
  /** SL/TP on positions and pending orders. */
  stops: boolean
  /** Floors and targets live (false: floors at 1% of the start, no targets). */
  rules: boolean
}

async function seedBook(dbs: PGlite[], r: Rng, count: number, flatShare: number, book: Book, feed: Feed) {
  const statements: { sql: string; params: unknown[] }[] = []
  for (let i = 0; i < count; i++) {
    const id = uuid(r)
    const starting = pick(r, [10_000, 25_000, 50_000, 100_000])
    const balance = r2(starting * (1 + (r() * 0.07 - 0.03)))
    const funded = r() < 0.2
    const minDays = book.rules && !funded ? pick(r, [0, 0, 3]) : 0
    const tradeDays = minDays ? pick(r, [1, 4]) : 0
    statements.push({
      sql: `insert into accounts (id, phase, status, starting_balance, balance, equity, daily_start_balance, highest_equity,
              max_daily_drawdown, max_overall_drawdown, profit_target, last_daily_reset_at, min_trading_days, business_account_id)
            values ($1, $2::account_phase, $3::account_status, $4, $5, $5, $6, $7, $8, $9, $10,
              case when $11 then forex_session_anchor(now()) - interval '1 day' else forex_session_anchor(now()) end, $12, null)`,
      params: [id, funded ? "funded" : "challenge", funded ? "funded" : "active", starting, balance,
        r2(balance * (1 + (r() * 0.02 - 0.01))), r2(Math.max(starting, balance)),
        book.rules ? pick(r, [0.04, 0.05]) : 0.99, book.rules ? pick(r, [0.08, 0.1]) : 0.99,
        book.rules && !funded ? pick(r, [0.05, 0.08]) : 0, r() < 0.15, minDays],
    })
    for (let d = 0; d < tradeDays; d++) {
      statements.push({
        sql: `insert into trades (account_id, symbol, direction, volume, open_price, close_price, open_time, gross_pnl, net_pnl, reason)
              values ($1, 'EURUSD', 'buy', 1, 1.1, 1.1, now() - make_interval(days => $2), 0, 0, 'manual')`,
        params: [id, d + 1],
      })
    }
    if (r() < flatShare) continue
    const n = 1 + Math.floor(r() * 3)
    for (let k = 0; k < n; k++) {
      const symbol = pick(r, Object.keys(SYMBOLS))
      const m = SYMBOLS[symbol]!
      const px = feed.prices[symbol]!
      const dir = r() < 0.5 ? "buy" : "sell"
      const notional = balance * (book.stops ? 0.2 + r() * 0.4 : 0.6 + r() * 2.2)
      const volume = Number((notional / (px * m.contract)).toFixed(4)) || 0.0001
      const sign = dir === "buy" ? 1 : -1
      const sl = book.stops && r() < 0.8 ? Number((px * (1 - sign * (0.004 + r() * 0.02))).toFixed(m.digits)) : null
      const tp = book.stops && r() < 0.8 ? Number((px * (1 + sign * (0.004 + r() * 0.02))).toFixed(m.digits)) : null
      statements.push({
        sql: `insert into positions (id, account_id, symbol, direction, volume, open_price, contract_size, digits, stop_loss, take_profit, commission, margin)
              values ($1, $2, $3, $4::trade_direction, $5, $6, $7, $8, $9, $10, $11, $12)`,
        params: [uuid(r), id, symbol, dir, volume, px, m.contract, m.digits, sl, tp, 6 * volume, r2((volume * m.contract * px) / 100)],
      })
    }
    if (book.stops) {
      const orders = Math.floor(r() * 3)
      for (let k = 0; k < orders; k++) {
        const symbol = pick(r, Object.keys(SYMBOLS))
        const m = SYMBOLS[symbol]!
        const px = feed.prices[symbol]!
        const kind = r() < 0.5 ? "limit" : "stop"
        const dir = r() < 0.5 ? "buy" : "sell"
        // limit buy / stop sell sit under the market; limit sell / stop buy above it.
        const below = (kind === "limit" && dir === "buy") || (kind === "stop" && dir === "sell")
        const trigger = Number((px * (1 + (below ? -1 : 1) * (0.002 + r() * 0.01))).toFixed(m.digits))
        const volume = Number(((balance * 0.3) / (px * m.contract)).toFixed(4)) || 0.0001
        const sign = dir === "buy" ? 1 : -1
        statements.push({
          sql: `insert into orders (id, account_id, symbol, direction, kind, volume, trigger_price, placed_price, stop_loss, take_profit)
                values ($1, $2, $3, $4::trade_direction, $5::order_kind, $6, $7, $8, $9, $10)`,
          params: [uuid(r), id, symbol, dir, kind, volume, trigger, px,
            Number((trigger * (1 - sign * 0.01)).toFixed(m.digits)), Number((trigger * (1 + sign * 0.01)).toFixed(m.digits))],
        })
      }
    }
  }
  for (const db of dbs) for (const s of statements) await db.query(s.sql, s.params)
}

async function dump(pg: PGlite, opts: { equity: boolean }) {
  const q = async (sql: string) => (await pg.query(sql)).rows
  return {
    trades: await q(`select account_id, symbol, direction::text, volume::text, open_price::text, close_price::text,
                       gross_pnl::text, commission::text, net_pnl::text, reason::text from trades where reason <> 'manual' or close_price <> 1.1
                     order by account_id, symbol, direction, volume, open_price, close_price, reason`),
    events: await q(`select account_id, type::text, equity_at_event::text, detail from account_events
                     order by account_id, type, equity_at_event, detail`),
    accounts: await q(`select id, status::text, balance::text, daily_start_balance::text, breach_reason, last_daily_reset_at
                       ${opts.equity ? ", equity::text, highest_equity::text" : ""} from accounts order by id`),
    positions: await q(`select account_id, symbol, direction::text, volume::text, open_price::text, stop_loss::text, take_profit::text
                        from positions order by account_id, symbol, direction, volume, open_price`),
    orders: await q(`select id, status::text from orders order by id`),
  }
}

function recorder() {
  const sent: string[] = []
  const notify: CrmNotify = async (p) => { sent.push(`${p.status}:${p.terminal_account_id}`) }
  return { sent, notify }
}

async function simulate(seed: number, book: Book, opts: { accounts: number; flatShare: number; steps: number; cfg?: Partial<EngineConfig> }) {
  const r = rng(seed)
  const feed = new Feed()
  walk(r, feed)
  const [legacyPg, v4Pg] = [await openDb(), await openDb()]
  await seedBook([legacyPg, v4Pg], r, opts.accounts, opts.flatShare, book, feed)
  const legacyDb = pgRiskDb(legacyPg)
  const v4Db = pgRiskDb(v4Pg)
  const legacyCrm = recorder()
  const v4Crm = recorder()
  let t = Date.now()
  const clock = () => t
  const legacy = new LegacyEngine(legacyDb, feed, legacyCrm.notify, clock)
  const v4 = new RiskEngine(v4Db, feed, v4Crm.notify, { ...DEFAULT_CONFIG, ...opts.cfg }, clock)
  for (let step = 0; step < opts.steps; step++) {
    if (step > 0) walk(r, feed)
    await legacy.tick()
    await v4.step()
    t += DEFAULT_CONFIG.tickMs
  }
  await v4.flush()
  // Background webhooks (v4 sends them without holding up the loop).
  await new Promise((res) => setTimeout(res, 50))
  return { legacyPg, v4Pg, legacyDb, v4Db, legacyCrm, v4Crm, v4 }
}

async function nearSessionRoll(): Promise<boolean> {
  const pg = await openDb()
  const { rows } = await pg.query<{ near: boolean }>(
    "select least(abs(extract(epoch from (now() - forex_session_anchor(now())))), abs(extract(epoch from (forex_session_anchor(now()) + interval '1 day' - now())))) < 600 as near")
  await pg.close()
  return rows[0]!.near
}

test("rules regime: breaches, passes, 5pm rolls, equity and high-water marks match the legacy loop", async (t) => {
  if (await nearSessionRoll()) return t.skip("within 10 minutes of 5pm New York")
  for (const seed of [101, 202, 303]) {
    const sim = await simulate(seed, { stops: false, rules: true }, { accounts: 36, flatShare: 0.25, steps: 400 })
    const [a, b] = [await dump(sim.legacyPg, { equity: true }), await dump(sim.v4Pg, { equity: true })]
    const breaches = a.events.filter((e) => String(e.type).endsWith("breach")).length
    const passes = a.events.filter((e) => e.type === "target_hit").length
    t.diagnostic(`seed ${seed}: ${breaches} breaches, ${passes} passes, ${a.trades.length} closing trades`)
    assert.ok(breaches > 0 && passes > 0, "the price path exercises breaches and passes")
    assert.deepEqual(b.trades, a.trades, `seed ${seed}: trades`)
    assert.deepEqual(b.events, a.events, `seed ${seed}: account events`)
    assert.deepEqual(b.accounts, a.accounts, `seed ${seed}: accounts (status, balance, baseline, equity, high-water)`)
    assert.deepEqual(b.positions, a.positions, `seed ${seed}: open positions`)
    assert.deepEqual([...sim.v4Crm.sent].sort(), [...sim.legacyCrm.sent].sort(), `seed ${seed}: CRM webhooks`)
    await sim.legacyPg.close()
    await sim.v4Pg.close()
  }
})

test("stops regime: SL/TP closes and pending-order fills match the legacy loop", async (t) => {
  if (await nearSessionRoll()) return t.skip("within 10 minutes of 5pm New York")
  for (const seed of [404, 505, 606]) {
    const sim = await simulate(seed, { stops: true, rules: false }, { accounts: 30, flatShare: 0.2, steps: 400 })
    // Equity is left out: after an SL/TP close the legacy loop marks the account on its balance from
    // before the close for one tick (see the next test), so its intermediate equity writes differ.
    const [a, b] = [await dump(sim.legacyPg, { equity: false }), await dump(sim.v4Pg, { equity: false })]
    const closes = a.trades.filter((x) => x.reason === "sl" || x.reason === "tp").length
    const fills = a.orders.filter((o) => o.status === "filled").length
    t.diagnostic(`seed ${seed}: ${closes} SL/TP closes, ${fills} fills`)
    assert.ok(closes > 0 && fills > 0, "the price path exercises SL/TP and fills")
    assert.deepEqual(b.trades, a.trades, `seed ${seed}: trades`)
    assert.deepEqual(b.orders, a.orders, `seed ${seed}: order statuses`)
    assert.deepEqual(b.positions, a.positions, `seed ${seed}: open positions`)
    assert.deepEqual(b.accounts, a.accounts, `seed ${seed}: balances and statuses`)
    await sim.legacyPg.close()
    await sim.v4Pg.close()
  }
})

test("a take-profit fill no longer reads as a breach (legacy marked on the pre-close balance)", async () => {
  // Balance 10,000, daily floor 9,500. One BTC position hits its take profit for +600 while an ETH position
  // floats -700. Real equity after the close: 10,600 - 700 = 9,900, above the floor. The legacy loop marked
  // the account on its balance from before the close (10,000 - 700 = 9,300) and breached it.
  const feed = new Feed()
  feed.prices = { "BTC/USD": 73_000, "ETH/USD": 2_700 }
  const [legacyPg, v4Pg] = [await openDb(), await openDb()]
  const id = "11111111-1111-4111-a111-111111111111"
  for (const pg of [legacyPg, v4Pg]) {
    await pg.query(`insert into accounts (id, phase, status, starting_balance, balance, equity, daily_start_balance, highest_equity,
                      max_daily_drawdown, max_overall_drawdown, profit_target, last_daily_reset_at)
                    values ($1, 'funded', 'funded', 10000, 10000, 10000, 10000, 10000, 0.05, 0.10, 0, forex_session_anchor(now()))`, [id])
    await pg.query(`insert into positions (account_id, symbol, direction, volume, open_price, contract_size, digits, take_profit, commission)
                    values ($1, 'BTC/USD', 'buy', 0.1, 73000, 1, 2, 79006, 0.6)`, [id])
    await pg.query(`insert into positions (account_id, symbol, direction, volume, open_price, contract_size, digits, commission)
                    values ($1, 'ETH/USD', 'buy', 1, 2700, 1, 2, 6)`, [id])
  }
  let t = Date.now()
  const legacy = new LegacyEngine(pgRiskDb(legacyPg), feed, recorder().notify, () => t)
  const v4 = new RiskEngine(pgRiskDb(v4Pg), feed, recorder().notify, DEFAULT_CONFIG, () => t)
  await legacy.tick()
  await v4.step()
  feed.prices = { "BTC/USD": 79_010, "ETH/USD": 2_000.54 } // BTC through its TP; ETH -699.46 gross
  t += 500
  await legacy.tick()
  await v4.step()
  await v4.flush()
  const status = async (pg: PGlite) => (await pg.query<{ s: string; b: string }>("select status::text s, balance::text b from accounts")).rows[0]!
  assert.equal((await status(legacyPg)).s, "breached", "legacy loop: false breach")
  const after = await status(v4Pg)
  assert.equal(after.s, "funded", "v4: the account keeps trading")
  assert.equal(after.b, "10600.00", "v4: TP booked at its level (+600.60 gross - 0.60 commission)")
  await legacyPg.close()
  await v4Pg.close()
})

test("requests per loop: production-shaped book (54 accounts, 9 with positions)", async (t) => {
  if (await nearSessionRoll()) return t.skip("within 10 minutes of 5pm New York")
  const sim = await simulate(2026, { stops: false, rules: true }, { accounts: 54, flatShare: 0.83, steps: 240 })
  const [a, b] = [await dump(sim.legacyPg, { equity: true }), await dump(sim.v4Pg, { equity: true })]
  assert.deepEqual(b.accounts, a.accounts)
  assert.deepEqual(b.events, a.events)
  const total = (c: Record<string, number>) => Object.values(c).reduce((x, y) => x + y, 0)
  const legacyWrites = Number((await sim.legacyPg.query<{ n: string }>("select n from write_log")).rows[0]!.n)
  const v4Writes = Number((await sim.v4Pg.query<{ n: string }>("select n from write_log")).rows[0]!.n)
  t.diagnostic(`240 loops (2 minutes at 500 ms): legacy ${total(sim.legacyDb.calls)} requests ${JSON.stringify(sim.legacyDb.calls)}`)
  t.diagnostic(`240 loops (2 minutes at 500 ms): v4 ${total(sim.v4Db.calls)} requests ${JSON.stringify(sim.v4Db.calls)}`)
  t.diagnostic(`account row writes: legacy ${legacyWrites}, v4 ${v4Writes}`)
  assert.ok(total(sim.v4Db.calls) * 10 < total(sim.legacyDb.calls), "at least 90% fewer requests")
  await sim.legacyPg.close()
  await sim.v4Pg.close()
})

test("risk_cycle missing (migration not applied yet): the engine reports it so the worker runs the legacy loop", async () => {
  const feed = new Feed()
  const err = Object.assign(new Error("Could not find the function public.risk_cycle"), { code: "PGRST202" })
  const db = { riskCycle: async () => { throw err } } as unknown as ConstructorParameters<typeof RiskEngine>[0]
  const engine = new RiskEngine(db, feed, recorder().notify)
  await assert.rejects(engine.step(), { name: "Error", message: "risk_cycle is not deployed" })
})

test("a large book: at most maxTicks equity writes per cycle, the rest go out in the next cycles", async () => {
  const pg = await openDb()
  await pg.exec(`
    insert into accounts (id, phase, status, starting_balance, balance, equity, daily_start_balance, highest_equity,
      max_daily_drawdown, max_overall_drawdown, profit_target, last_daily_reset_at)
    select gen_random_uuid(), 'funded', 'funded', 100000, 100000, 100000, 100000, 100000, 0.05, 0.10, 0, forex_session_anchor(now())
    from generate_series(1, 600);
    insert into positions (account_id, symbol, direction, volume, open_price, contract_size, digits, commission, margin)
    select id, 'BTC/USD', 'buy', 0.5, 73000, 1, 2, 3, 365 from accounts;
  `)
  const feed = new Feed()
  feed.prices = { "BTC/USD": 73_100 }
  const db = pgRiskDb(pg)
  const sizes: number[] = []
  const counting = { ...db, riskCycle: async (...args: Parameters<typeof db.riskCycle>) => { sizes.push(args[0].length); return db.riskCycle(...args) } }
  let t = Date.now()
  const engine = new RiskEngine(counting, feed, recorder().notify, { ...DEFAULT_CONFIG, maxTicks: 250 }, () => t)
  // Loading published the prices (a write), so the next write cycle is the first snapshot cycle at least
  // RISK_PERSIST_MS later (t = 6 s on the 2 s grid). The backlog follows on the next steps without waiting.
  for (let i = 0; i < 15; i++) {
    await engine.step()
    t += DEFAULT_CONFIG.tickMs
  }
  assert.ok(Math.max(...sizes) <= 250, `no cycle writes more than 250 accounts (${sizes.join(", ")})`)
  assert.deepEqual(sizes.filter((n) => n > 0), [250, 250, 100], "600 writes in three back-to-back cycles")
  const { rows } = await pg.query<{ n: number }>("select count(*)::int n from accounts where equity <> 100000")
  assert.equal(rows[0]!.n, 600, "every account's equity was written")
  await pg.close()
})

test("storedCents rounds exactly like Postgres numeric(18,2) does with the JSON text the worker sends", async () => {
  const pg = await openDb()
  const r = rng(77)
  const values: number[] = [100043.345, -100043.345, 0.005, 0.015, 1.005, 2.675, 9999.995, 12.3, 7, -0.004]
  for (let i = 0; i < 3000; i++) {
    const base = r() * 200_000
    values.push(base, Number(base.toFixed(3)), Math.round(base * 1000) / 1000 + 0.0005, -base)
  }
  const { rows } = await pg.query<{ v: string }>(
    "select round(x::numeric, 2)::float8::text as v from unnest($1::text[]) with ordinality as t(x, i) order by i",
    [values.map(String)])
  values.forEach((x, i) => assert.equal(storedCents(x), Number(rows[i]!.v), `round(${String(x)}, 2)`))
  await pg.close()
})

test("writes are batched: equity and prices share one transaction per persist period; prices stay fresh", async () => {
  const pg = await openDb()
  await pg.exec(`
    insert into accounts (id, phase, status, starting_balance, balance, equity, daily_start_balance, highest_equity,
      max_daily_drawdown, max_overall_drawdown, profit_target, last_daily_reset_at)
    select gen_random_uuid(), 'funded', 'funded', 100000, 100000, 100000, 100000, 100000, 0.05, 0.10, 0, forex_session_anchor(now())
    from generate_series(1, 4);
    insert into positions (account_id, symbol, direction, volume, open_price, contract_size, digits, commission, margin)
    select id, 'BTC/USD', 'buy', 0.5, 73000, 1, 2, 3, 365 from accounts;
  `)
  // A live feed: symbols arrive at different times and some are quiet for a few ticks, so each symbol's own
  // publish timer drifts out of step with the others (what production showed on 2026-11-27).
  const prices: Record<string, number> = { "BTC/USD": 73_000, "ETH/USD": 2_700, EURUSD: 1.144, GBPUSD: 1.34, USDJPY: 162.4 }
  const real = new Set(["BTC/USD", "ETH/USD", "EURUSD", "USDJPY"])
  const feed: PriceFeed = { get: (sym) => prices[sym], all: () => ({ ...prices }), isReal: (sym) => real.has(sym) }
  const db = pgRiskDb(pg)
  let t = Date.now()
  const writes: number[] = []
  const lastSeen: Record<string, number> = {}
  let maxGap = 0
  const counting = {
    ...db,
    riskCycle: async (...args: Parameters<typeof db.riskCycle>) => {
      const [ticks, prices] = args
      if (ticks.length > 0 || prices.length > 0) writes.push(t)
      for (const p of prices) {
        if (lastSeen[p.symbol] !== undefined) maxGap = Math.max(maxGap, t - lastSeen[p.symbol]!)
        lastSeen[p.symbol] = t
      }
      return db.riskCycle(...args)
    },
  }
  const engine = new RiskEngine(counting, feed, recorder().notify, DEFAULT_CONFIG, () => t)
  for (let step = 0; step < 120; step++) {
    if (step === 3) real.add("GBPUSD") // first real GBPUSD price 1.5 s after the others
    for (const sym of Object.keys(prices)) {
      if (sym === "USDJPY" && step % 5 !== 0) continue // quiet for 2 s at a time
      prices[sym] = Number((prices[sym]! * (1 + 0.0001 * (1 + (step % 3)))).toFixed(5))
    }
    await engine.step()
    t += DEFAULT_CONFIG.tickMs
  }
  const cycles = engine.stats.cycles
  // 60 s: cycles every 2 s (~30); write cycles only every persist period (5 s on a 2 s grid: every ~6 s).
  assert.ok(writes.length <= 12, `write cycles in 60 s: ${writes.length} (of ${cycles} cycles)`)
  assert.ok(writes.length >= 9, `equity and prices still go out regularly: ${writes.length}`)
  assert.ok(maxGap <= 8_000, `no symbol waits more than 8 s for a publish (max gap ${maxGap} ms)`)
  const { rows } = await pg.query<{ n: number }>("select count(*)::int n from accounts where equity <> 100000")
  assert.equal(rows[0]!.n, 4, "every account's equity was written")
  await pg.close()
})
