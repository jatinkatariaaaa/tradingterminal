// The risk worker's database calls against an in-process PostgreSQL 17 (PGlite) that holds the live schema,
// the live trading functions and the engine v4 migration. Numbers come back as numbers, as PostgREST
// returns them to supabase-js.

import { readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import type { AccountRow, CycleResult, OrderRow, PositionRow, RiskDb } from "../src/types.js"

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8")
export const SCHEMA = [
  read("../../../supabase/tests/engine-v4/base.sql"),
  read("./fixtures/engine-functions.sql"),
  read("../../../supabase/migrations/20261127090000_engine_v4_fewer_writes.sql"),
  read("../../../supabase/migrations/20261127090100_engine_v4_apply_risk_tick.sql"),
]

const NUMERIC_FIELDS = new Set([
  "balance", "equity", "starting_balance", "daily_start_balance", "max_daily_drawdown", "max_overall_drawdown",
  "profit_target", "leverage", "highest_equity", "min_trading_days", "volume", "open_price", "contract_size",
  "digits", "stop_loss", "take_profit", "commission", "margin", "trigger_price", "placed_price",
])

function numbers<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) out[k] = NUMERIC_FIELDS.has(k) && v != null ? Number(v) : v
  return out as T
}

const ACCOUNTS =
  "id, status::text as status, phase::text as phase, balance, equity, starting_balance, daily_start_balance, max_daily_drawdown, max_overall_drawdown, profit_target, last_daily_reset_at, leverage"
const POSITIONS =
  "id, account_id, symbol, direction::text as direction, volume, open_price, contract_size, digits, stop_loss, take_profit, commission, margin"
const ORDERS =
  "id, account_id, symbol, direction::text as direction, kind::text as kind, volume, trigger_price, placed_price, stop_loss, take_profit"

export async function openDb(): Promise<PGlite> {
  const pg = new PGlite()
  for (const sql of SCHEMA) await pg.exec(sql)
  return pg
}

export interface CallLog {
  calls: Record<string, number>
}

/** A RiskDb on PGlite that also counts calls by name, like the edge logs count requests. */
export function pgRiskDb(pg: PGlite): RiskDb & CallLog {
  const calls: Record<string, number> = {}
  const count = (name: string) => (calls[name] = (calls[name] ?? 0) + 1)
  const rows = async <T>(sql: string, params: unknown[] = []) =>
    (await pg.query<Record<string, unknown>>(sql, params)).rows.map((r) => numbers<T>(r))

  return {
    calls,
    async fetchTradableAccounts() {
      count("accounts")
      return rows<AccountRow>(`select ${ACCOUNTS} from accounts where status in ('active','funded')`)
    },
    async fetchAllPositions(ids) {
      count("positions")
      if (!ids.length) return []
      return rows<PositionRow>(`select ${POSITIONS} from positions where account_id = any($1::uuid[])`, [ids])
    },
    async fetchAllWorkingOrders(ids) {
      count("orders")
      if (!ids.length) return []
      return rows<OrderRow>(
        `select ${ORDERS} from orders where account_id = any($1::uuid[]) and status = 'working'`, [ids])
    },
    async fetchAccountSnapshot(id) {
      count("account_snapshot")
      const [r] = await rows<AccountRow>(`select ${ACCOUNTS} from accounts where id = $1`, [id])
      if (!r) throw new Error(`account ${id} not found`)
      return r
    },
    async applyRiskTick(id, equity) {
      count("apply_risk_tick")
      const { rows: [r] } = await pg.query<{ s: string }>("select apply_risk_tick($1, $2)::text as s", [id, equity])
      return r!.s as AccountRow["status"]
    },
    async closePosition(a) {
      count("close_position")
      await pg.query("select close_position($1, $2, $3, $4, $5::close_reason)", [a.positionId, a.exitFill, a.grossPnl, a.commission, a.reason])
    },
    async fillOrder(a) {
      count("fill_order")
      const { rows: [r] } = await pg.query<{ id: string | null }>(
        "select (fill_order($1, $2, $3, $4::smallint, $5, $6)).id as id", [a.orderId, a.entryFill, a.contractSize, a.digits, a.margin, a.commission])
      return r?.id != null
    },
    async breachAccount(a) {
      count("breach_account")
      await pg.query("select breach_account($1, $2, $3::account_event_type, $4, $5::jsonb)", [a.accountId, a.equity, a.kind, a.reason, JSON.stringify(a.marks)])
    },
    async passAccount(a) {
      count("pass_account")
      const [r] = await rows<AccountRow>("select (p).id, (p).status::text as status, (p).balance, (p).equity from (select pass_account($1, $2, $3::jsonb) p) x",
        [a.accountId, a.equity, JSON.stringify(a.marks)])
      return r!
    },
    async upsertPrices(list) {
      count("prices")
      for (const p of list) {
        await pg.query(
          "insert into prices (symbol, price, updated_at) values ($1, $2, $3) on conflict (symbol) do update set price = excluded.price, updated_at = excluded.updated_at",
          [p.symbol, p.price, p.updated_at])
      }
    },
    async riskCycle(ticks, prices, known) {
      count("risk_cycle")
      const { rows: [r] } = await pg.query<{ o: CycleResult }>("select risk_cycle($1::jsonb, $2::jsonb, $3::jsonb) as o",
        [JSON.stringify(ticks), JSON.stringify(prices), JSON.stringify(known)])
      return r!.o
    },
  }
}
