// Differential tests for 20261127090000_engine_v4_fewer_writes.sql.
//
// Two in-process PostgreSQL 17 databases (PGlite) get the live schema from base.sql. One keeps the live
// apply_risk_tick; the other gets the engine v4 migration. Both receive the same accounts and the same
// tick sequences, and after every step the tests compare what each returned and every column of
// accounts, account_events and trading_accounts (updated_at aside: v4 skips writes that would not change
// a stored value, so it also skips bumping that timestamp).
//
// Run: npm install && npm test   (from supabase/tests/engine-v4)

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8")
const BASE = read("./base.sql")
const MIGRATION = [
  read("../../migrations/20261127090000_engine_v4_fewer_writes.sql"),
  read("../../migrations/20261127090100_engine_v4_apply_risk_tick.sql"),
].join("\n")
const ROLLBACK = read("../../rollbacks/20261127090000_engine_v4_fewer_writes.down.sql")

async function makeDb({ v4 }) {
  const db = new PGlite()
  await db.exec(BASE)
  if (v4) await db.exec(MIGRATION)
  return db
}

// Deterministic randomness so a failure can be replayed.
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pick = (r, list) => list[Math.floor(r() * list.length)]
const uuidFrom = (r) => {
  const h = () => Math.floor(r() * 16).toString(16)
  const s = Array.from({ length: 32 }, h).join("")
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-a${s.slice(17, 20)}-${s.slice(20, 32)}`
}
const r2 = (x) => Math.round(x * 100) / 100

/** Builds the same accounts (and trading_accounts, trades, positions) in every database given. */
async function seed(dbs, r, count) {
  const accounts = []
  for (let i = 0; i < count; i++) {
    const starting = pick(r, [5000, 10000, 25000, 50000, 100000])
    const balance = r2(starting * (1 + (r() * 0.2 - 0.08)))
    const a = {
      id: uuidFrom(r),
      biz: r() < 0.5 ? uuidFrom(r) : null,
      phase: r() < 0.75 ? "challenge" : "funded",
      status: pick(r, ["active", "active", "active", "active", "funded", "passed", "breached", "suspended"]),
      starting,
      balance,
      equity: r() < 0.7 ? balance : r2(balance * (1 + (r() * 0.02 - 0.01))),
      daily: r2(balance * (1 + (r() * 0.04 - 0.02))),
      highest: r() < 0.1 ? null : r2(Math.max(starting, balance) * (1 + r() * 0.02)),
      dd: pick(r, ["0.0300", "0.0400", "0.0500"]),
      odd: pick(r, ["0.0600", "0.0800", "0.1000"]),
      pt: pick(r, ["0", "0.0500", "0.0800", "0.1000"]),
      reset: pick(r, ["current", "current", "current", "current", "due", "null"]),
      minDays: pick(r, [0, 0, 3]),
      tradeDays: Math.floor(r() * 5),
    }
    if (a.status === "funded") a.phase = "funded"
    accounts.push(a)
  }
  for (const db of dbs) {
    for (const a of accounts) {
      if (a.biz) await db.query("insert into trading_accounts (id, status) values ($1, 'active')", [a.biz])
      await db.query(
        `insert into accounts (id, business_account_id, phase, status, starting_balance, balance, equity,
           daily_start_balance, highest_equity, max_daily_drawdown, max_overall_drawdown, profit_target,
           last_daily_reset_at, min_trading_days)
         values ($1, $2, $3::account_phase, $4::account_status, $5, $6, $7, $8, $9, $10::numeric, $11::numeric,
           $12::numeric,
           case $13 when 'current' then forex_session_anchor(now())
                    when 'due' then forex_session_anchor(now()) - interval '1 day' end,
           $14)`,
        [a.id, a.biz, a.phase, a.status, a.starting, a.balance, a.equity, a.daily, a.highest, a.dd, a.odd, a.pt,
          a.reset, a.minDays],
      )
      for (let d = 0; d < a.tradeDays; d++) {
        await db.query(
          `insert into trades (account_id, symbol, direction, volume, open_price, close_price, open_time,
             gross_pnl, net_pnl, reason)
           values ($1, 'EURUSD', 'buy', 1, 1.1, 1.1, now() - make_interval(days => $2), 0, 0, 'manual')`,
          [a.id, d + 1],
        )
      }
    }
  }
  return accounts
}

/** An equity to send for an account: no-ops, sub-cent moves, random moves and every rule edge. */
async function nextEquity(db, r, id) {
  const { rows } = await db.query(
    `select equity::float8 e, balance::float8 b, starting_balance::float8 s, daily_start_balance::float8 d,
            highest_equity::float8 h, max_daily_drawdown::float8 dd, max_overall_drawdown::float8 odd,
            profit_target::float8 pt
       from accounts where id = $1`, [id])
  const a = rows[0]
  const daily = a.d * (1 - a.dd)
  const overall = a.s * (1 - a.odd)
  const floor = Math.max(daily, overall)
  const target = a.s * (1 + a.pt)
  const kind = Math.floor(r() * 12)
  switch (kind) {
    case 0: return String(a.e) // unchanged
    case 1: return (a.e + (r() * 0.008 - 0.004)).toFixed(9) // moves under half a cent
    case 2: return (a.e + 0.005).toFixed(3) // rounds up a cent
    case 3: return (a.h == null ? a.e : a.h + 0.004).toFixed(3) // just under a new high
    case 4: return (a.h == null ? a.e : a.h + 0.005).toFixed(3) // a new high by rounding
    case 5: return floor.toFixed(6) // exactly at the floor
    case 6: return (floor - r() * 50).toFixed(7) // under the floor
    case 7: return (target + r() * 20).toFixed(7) // over the target
    case 8: return target.toFixed(6) // exactly at the target
    default: return (a.b * (1 + (r() * 0.04 - 0.02))).toFixed(10) // ordinary move
  }
}

const STATE_SQL = {
  accounts: `select id, user_id, label, phase, status, starting_balance, balance, equity, daily_start_balance,
               highest_equity, max_daily_drawdown, max_overall_drawdown, profit_target, breach_reason,
               last_daily_reset_at, program_key, business_account_id, min_trading_days, leverage, reset_at
             from accounts order by id`,
  events: `select account_id, type, equity_at_event, detail from account_events
             order by account_id, created_at, type, equity_at_event, detail`,
  trading: `select id, balance, equity, highest_equity, current_daily_drawdown, current_max_drawdown, status,
               breach_reason from trading_accounts order by id`,
}
async function state(db) {
  const out = {}
  for (const [k, sql] of Object.entries(STATE_SQL)) out[k] = (await db.query(sql)).rows
  return out
}
const writes = async (db) => Number((await db.query("select n from write_log")).rows[0].n)

async function nearSessionRoll() {
  const db = new PGlite()
  await db.exec(BASE)
  const { rows } = await db.query(
    "select abs(extract(epoch from (now() - forex_session_anchor(now()) - interval '1 day'))) < 120 as near_next, extract(epoch from (now() - forex_session_anchor(now()))) < 120 as near_prev")
  await db.close()
  return rows[0].near_next || rows[0].near_prev
}

test("apply_risk_tick: v4 returns and stores exactly what the live function does", async (t) => {
  if (await nearSessionRoll()) return t.skip("within 2 minutes of 5pm New York: the session anchor could move mid-test")
  for (const seedNo of [1, 2, 3, 4, 5]) {
    const r = rng(seedNo)
    const [oldDb, newDb] = [await makeDb({ v4: false }), await makeDb({ v4: true })]
    const accounts = await seed([oldDb, newDb], r, 40)
    const ids = accounts.map((a) => a.id)
    for (let step = 0; step < 600; step++) {
      const id = pick(r, ids)
      const equity = await nextEquity(oldDb, r, id)
      const sql = "select apply_risk_tick($1, $2::numeric)::text as s"
      const [a, b] = await Promise.all([oldDb.query(sql, [id, equity]), newDb.query(sql, [id, equity])])
      assert.equal(b.rows[0].s, a.rows[0].s, `seed ${seedNo} step ${step}: status for equity ${equity}`)
      if (step % 25 === 0 || step === 599) {
        assert.deepEqual(await state(newDb), await state(oldDb), `seed ${seedNo} step ${step}: stored state`)
      }
    }
    const [wOld, wNew] = [await writes(oldDb), await writes(newDb)]
    t.diagnostic(`seed ${seedNo}: account row writes live=${wOld} v4=${wNew}`)
    assert.ok(wNew <= wOld, "v4 never writes more than the live function")
    await oldDb.close()
    await newDb.close()
  }
})

test("a tick that changes nothing is read-only in v4 (no lock, no transaction id, no WAL)", async () => {
  const r = rng(42)
  const [oldDb, newDb] = [await makeDb({ v4: false }), await makeDb({ v4: true })]
  const [a] = await seed([oldDb, newDb], r, 1)
  await oldDb.query("update accounts set status = 'active', phase = 'challenge', profit_target = 0.08, last_daily_reset_at = forex_session_anchor(now()), equity = balance, daily_start_balance = balance, starting_balance = balance, highest_equity = balance where id = $1", [a.id])
  await newDb.query("update accounts set status = 'active', phase = 'challenge', profit_target = 0.08, last_daily_reset_at = forex_session_anchor(now()), equity = balance, daily_start_balance = balance, starting_balance = balance, highest_equity = balance where id = $1", [a.id])
  const xidAfterTick = async (db) => db.transaction(async (tx) => {
    const { rows: [acc] } = await tx.query("select equity::text e from accounts where id = $1", [a.id])
    await tx.query("select apply_risk_tick($1, $2::numeric)", [a.id, acc.e + "0004"])
    const { rows } = await tx.query("select pg_current_xact_id_if_assigned()::text as x")
    return rows[0].x
  })
  assert.notEqual(await xidAfterTick(oldDb), null, "live function: the row lock assigns a transaction id")
  assert.equal(await xidAfterTick(newDb), null, "v4: no transaction id, so the commit writes nothing")
  await oldDb.close()
  await newDb.close()
})

test("production mix: how many ticks still need a WAL flush", async (t) => {
  if (await nearSessionRoll()) return t.skip("within 2 minutes of 5pm New York")
  // Live on 2026-11-27: 54 tradable accounts, 0.89 account writes/s against 5.4 ticks/s, so about 84% of
  // ticks changed nothing (mostly accounts with no open position, whose equity is just their balance).
  const r = rng(2026)
  const [oldDb, newDb] = [await makeDb({ v4: false }), await makeDb({ v4: true })]
  const accounts = await seed([oldDb, newDb], r, 54)
  for (const db of [oldDb, newDb]) {
    await db.query(`update accounts set status = 'active', phase = 'challenge', profit_target = 0.08,
      equity = balance, daily_start_balance = balance, starting_balance = balance, highest_equity = balance,
      last_daily_reset_at = forex_session_anchor(now())`)
  }
  const moving = new Set(accounts.slice(0, 9).map((a) => a.id)) // ~16% have an open position
  const xids = { live: 0, v4: 0 }
  const ticks = 1000
  for (let i = 0; i < ticks; i++) {
    const a = accounts[i % accounts.length]
    const { rows: [cur] } = await oldDb.query("select balance::float8 b, equity::text e from accounts where id = $1", [a.id])
    const equity = moving.has(a.id) ? (cur.b * (1 + (r() * 0.004 - 0.002))).toFixed(9) : cur.e
    for (const [name, db] of [["live", oldDb], ["v4", newDb]]) {
      const x = await db.transaction(async (tx) => {
        await tx.query("select apply_risk_tick($1, $2::numeric)", [a.id, equity])
        return (await tx.query("select pg_current_xact_id_if_assigned()::text x")).rows[0].x
      })
      if (x !== null) xids[name]++
    }
  }
  assert.deepEqual(await state(newDb), await state(oldDb))
  t.diagnostic(`ticks needing a WAL flush at commit, per ${ticks}: live=${xids.live} v4=${xids.v4}`)
  assert.equal(xids.live, ticks, "the live function locks the row on every tick")
  assert.ok(xids.v4 <= ticks * 0.2, "v4 only writes when something changed")
  await oldDb.close()
  await newDb.close()
})

test("risk_cycle applies a loop's ticks exactly like one apply_risk_tick call each", async (t) => {
  if (await nearSessionRoll()) return t.skip("within 2 minutes of 5pm New York")
  for (const seedNo of [11, 12, 13]) {
    const r = rng(seedNo)
    const [oldDb, newDb] = [await makeDb({ v4: false }), await makeDb({ v4: true })]
    const accounts = await seed([oldDb, newDb], r, 30)
    for (let cycle = 0; cycle < 80; cycle++) {
      const batch = accounts.filter(() => r() < 0.4)
      const ticks = []
      for (const a of batch) ticks.push({ id: a.id, equity: await nextEquity(oldDb, r, a.id) })
      ticks.sort((x, y) => (x.id < y.id ? -1 : 1))
      const expected = {}
      for (const tk of ticks) {
        const { rows } = await oldDb.query("select apply_risk_tick($1, $2::numeric)::text s", [tk.id, tk.equity])
        expected[tk.id] = rows[0].s
      }
      // Send the same decimal text the old calls got (as JSON numbers), so both sides see identical numerics.
      const literal = JSON.stringify(ticks.map((tk) => ({ id: tk.id, equity: "EQ" + tk.equity, peak: "EQ" + tk.equity })))
        .replace(/"EQ([-0-9.]+)"/g, "$1")
      const { rows } = await newDb.query("select risk_cycle($1::jsonb, '[]'::jsonb, '{}'::jsonb) as out", [literal])
      const got = Object.fromEntries(rows[0].out.ticks.map((x) => [x.id, x.status ?? `error: ${x.error}`]))
      assert.deepEqual(got, expected, `seed ${seedNo} cycle ${cycle}: statuses`)
      assert.deepEqual(await state(newDb), await state(oldDb), `seed ${seedNo} cycle ${cycle}: stored state`)
    }
    t.diagnostic(`seed ${seedNo}: account row writes live=${await writes(oldDb)} v4=${await writes(newDb)}`)
    await oldDb.close()
    await newDb.close()
  }
})

test("risk_cycle keeps the high-water mark exact when the worker persists less often than it marks", async () => {
  const r = rng(7)
  const [oldDb, newDb] = [await makeDb({ v4: false }), await makeDb({ v4: true })]
  const [a] = await seed([oldDb, newDb], r, 1)
  for (const db of [oldDb, newDb]) {
    await db.query(`update accounts set status = 'active', phase = 'challenge', profit_target = 0.10,
      starting_balance = 10000, balance = 10000, equity = 10000, daily_start_balance = 10000, highest_equity = 10000,
      last_daily_reset_at = forex_session_anchor(now()) where id = $1`, [a.id])
  }
  // Live engine: every mark was written. v4 worker: it saw a peak of 10,412.346 between writes.
  for (const e of ["10120.1", "10412.346", "10230.554"]) await oldDb.query("select apply_risk_tick($1, $2::numeric)", [a.id, e])
  await newDb.query("select risk_cycle($1::jsonb)", [JSON.stringify([{ id: a.id, equity: 10230.554, peak: 10412.346 }])])
  assert.deepEqual(await state(newDb), await state(oldDb))
  await oldDb.close()
  await newDb.close()
})

test("risk_cycle snapshot: one consistent read, parts sent only when they change", async () => {
  const db = await makeDb({ v4: true })
  const r = rng(99)
  const accounts = await seed([db], r, 8)
  await db.query("update accounts set status = 'active', last_daily_reset_at = forex_session_anchor(now())")
  const cycle = async (ticks = [], prices = [], known = {}) =>
    (await db.query("select risk_cycle($1::jsonb, $2::jsonb, $3::jsonb) as o",
      [JSON.stringify(ticks), JSON.stringify(prices), JSON.stringify(known)])).rows[0].o

  const first = await cycle()
  assert.equal(first.accounts.length, 8)
  assert.deepEqual(first.positions, [])
  assert.deepEqual(first.orders, [])
  assert.deepEqual(first.due_daily_reset, [])
  assert.ok(new Date(first.next_daily_reset_at) > new Date(first.now), "next 5pm New York is in the future")

  const quiet = await cycle([], [], first.fp)
  assert.equal(quiet.accounts, null, "unchanged accounts are not resent")
  assert.equal(quiet.positions, null)
  assert.equal(quiet.orders, null)
  assert.ok(JSON.stringify(quiet).length < 600, `a quiet cycle is small (${JSON.stringify(quiet).length} bytes)`)

  const id = accounts[0].id
  const equityOnly = await cycle([{ id, equity: Number(first.accounts.find((x) => x.id === id).balance) + 12.34 }], [], first.fp)
  assert.equal(equityOnly.accounts, null, "the worker's own equity writes do not resend the accounts")
  assert.equal(equityOnly.ticks[0].status, "active")

  await db.query("update accounts set balance = balance - 50 where id = $1", [id])
  const balance = await cycle([], [], first.fp)
  assert.equal(balance.accounts.length, 8, "a balance change resends the accounts")

  await db.query(`insert into positions (account_id, symbol, direction, volume, open_price, contract_size, digits, stop_loss)
                  values ($1, 'EURUSD', 'buy', 1, 1.1, 100000, 5, 1.09)`, [id])
  const opened = await cycle([], [], balance.fp)
  assert.equal(opened.accounts, null)
  assert.equal(opened.positions.length, 1, "a new position is sent")
  await db.query("update positions set stop_loss = 1.095")
  const modified = await cycle([], [], opened.fp)
  assert.equal(Number(modified.positions[0].stop_loss), 1.095, "a stop loss change is sent")

  await db.query(`insert into orders (account_id, symbol, direction, kind, volume, trigger_price, placed_price)
                  values ($1, 'EURUSD', 'buy', 'limit', 1, 1.08, 1.1)`, [id])
  const ordered = await cycle([], [], modified.fp)
  assert.equal(ordered.orders.length, 1, "a new working order is sent")
  await db.query("update orders set status = 'cancelled'")
  const cancelled = await cycle([], [], ordered.fp)
  assert.deepEqual(cancelled.orders, [], "a cancelled order is removed")

  await db.query("update accounts set status = 'breached' where id = $1", [id])
  const breached = await cycle([], [], cancelled.fp)
  assert.equal(breached.accounts.length, 7, "a breached account leaves the tradable set")
  assert.deepEqual(breached.positions, [], "and its positions with it")

  await db.query("update accounts set last_daily_reset_at = null where id = $1", [accounts[1].id])
  const due = await cycle([], [], breached.fp)
  assert.deepEqual(due.due_daily_reset, [accounts[1].id], "accounts needing the 5pm roll are listed")
  const rolled = await cycle([{ id: accounts[1].id, equity: Number(first.accounts.find((x) => x.id === accounts[1].id).equity) }], [], due.fp)
  assert.deepEqual(rolled.due_daily_reset, [], "and leave the list once ticked")

  const { rows: [anchors] } = await db.query(
    "select forex_session_anchor($1::timestamptz) = $1::timestamptz as on_anchor, forex_session_anchor($1::timestamptz - interval '1 second') = forex_session_anchor(now()) as current",
    [first.next_daily_reset_at])
  assert.ok(anchors.on_anchor && anchors.current, "next_daily_reset_at is exactly the next session anchor")
  await db.close()
})

test("risk_cycle prices: same upsert as before; bad rows are skipped, duplicates keep the newest", async () => {
  const db = await makeDb({ v4: true })
  await db.query("insert into prices values ('EURUSD', 1.1, now() - interval '1 minute')")
  const stamp = new Date().toISOString()
  await db.query("select risk_cycle('[]'::jsonb, $1::jsonb)", [JSON.stringify([
    { symbol: "EURUSD", price: 1.12345, updated_at: stamp },
    { symbol: "BTC/USD", price: 73000.5, updated_at: stamp },
    { symbol: "BTC/USD", price: 73001.5, updated_at: new Date(Date.parse(stamp) + 1000).toISOString() },
    { symbol: "XAUUSD", price: 0, updated_at: stamp },
  ])])
  const { rows } = await db.query("select symbol, price::float8 p from prices order by symbol")
  assert.deepEqual(rows, [{ symbol: "BTC/USD", p: 73001.5 }, { symbol: "EURUSD", p: 1.12345 }])
  await db.close()
})

test("risk_cycle isolates a failing account; the rest of the loop still applies", async () => {
  const db = await makeDb({ v4: true })
  const [a] = await seed([db], rng(5), 1)
  await db.query("update accounts set status = 'active', last_daily_reset_at = forex_session_anchor(now()) where id = $1", [a.id])
  const missing = "00000000-0000-4000-a000-000000000000"
  const { rows } = await db.query("select risk_cycle($1::jsonb) as o", [JSON.stringify([
    { id: missing, equity: 1 }, { id: a.id, equity: 12345.67 },
  ])])
  const byId = Object.fromEntries(rows[0].o.ticks.map((x) => [x.id, x]))
  assert.match(byId[missing].error, /not found/)
  assert.ok(byId[a.id].status)
  assert.equal((await db.query("select equity::text e from accounts where id = $1", [a.id])).rows[0].e, "12345.67")
  await db.close()
})

test("the rollback restores the live apply_risk_tick and removes risk_cycle", async (t) => {
  if (await nearSessionRoll()) return t.skip("within 2 minutes of 5pm New York")
  const r = rng(21)
  const [oldDb, rolledDb] = [await makeDb({ v4: false }), await makeDb({ v4: true })]
  await rolledDb.exec(ROLLBACK)
  const accounts = await seed([oldDb, rolledDb], r, 20)
  for (let step = 0; step < 200; step++) {
    const id = pick(r, accounts).id
    const equity = await nextEquity(oldDb, r, id)
    await oldDb.query("select apply_risk_tick($1, $2::numeric)", [id, equity])
    await rolledDb.query("select apply_risk_tick($1, $2::numeric)", [id, equity])
  }
  assert.deepEqual(await state(rolledDb), await state(oldDb))
  assert.equal(await writes(rolledDb), await writes(oldDb), "same write pattern as the live function")
  const { rows } = await rolledDb.query("select count(*)::int n from pg_proc where proname in ('risk_cycle', 'risk_tick')")
  assert.equal(rows[0].n, 0)
  await oldDb.close()
  await rolledDb.close()
})
