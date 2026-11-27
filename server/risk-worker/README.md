# Risk Worker

Standalone, server-authoritative risk engine. It ingests prices **independently** (never trusting any
browser), marks every open position on the **close side** of the spread (bid for longs, ask for shorts),
recomputes equity, fills triggered pending orders, applies SL/TP, rolls the 5pm ET daily baseline, and
fires drawdown breaches and profit-target passes, all through the `SECURITY DEFINER` functions in
`supabase/migrations` with the **service-role** key.

This is the only component (besides the `/api/trade` routes) allowed to write money, positions and
trades. The browser remains read-only.

## Engine v4 (default)

`src/engine.ts`. The same rules as before (`src/rules.ts`), evaluated in memory on every tick, with the
database touched only when something has to change:

- **Every tick** (`RISK_TICK_MS`, 500 ms): mark every tradable account on the live feed; fill triggered
  pending orders, close SL/TP hits, breach accounts at or under their floor, and hand an account that
  reached its profit target to SQL. These events go to the database the moment they happen.
- **Every cycle**: one `risk_cycle` request returns the account / position / order snapshot, but only the
  parts that changed (fingerprints), so a quiet cycle is a few hundred bytes. It runs every
  `RISK_CYCLE_MS` (2 s) while any position or order is open and every `RISK_IDLE_CYCLE_MS` (4 s) while
  the book is flat, so a new position or order is picked up within that time.
- **Writes are batched**: every `RISK_PERSIST_MS` (5 s) the cycle also carries the equity of every account
  whose stored value would change and the prices the trade routes fill from, in one transaction. The
  5pm New York roll and a reached profit target go out at once. A cycle with nothing to write is
  read-only (no WAL, no flush to disk).
- After an event, the account is marked again on a fresh snapshot before anything else happens to it, so
  the engine never trades on a balance or position list it has just changed.

Before v4 the worker made three reads, a price upsert and one `apply_risk_tick` call per tradable account
on every loop, one after another. With 54 accounts that was about 470,000 requests a day, and each loop
took about 8 seconds, so every account was re-checked only every ~8 s (and slower as accounts grew).

### Settings

| Variable | Default | What it does |
| --- | --- | --- |
| `RISK_ENGINE` | `v4` | `legacy` runs the pre-v4 loop (`src/legacy.ts`) |
| `RISK_TICK_MS` | `500` | in-memory marking cadence |
| `RISK_CYCLE_MS` | `2000` | snapshot cadence while any position or order is open |
| `RISK_PERSIST_MS` | `5000` | equity and price writes, batched into one transaction |
| `RISK_IDLE_CYCLE_MS` | `4000` | snapshot cadence while no account has a position or a working order |
| `PRICE_PUBLISH_MS` | `5000` | a changed price is republished at most this often |
| `PRICE_REFRESH_MS` | `30000` | an unchanged price is still republished this often (`open_market_position` rejects prices older than 60 s) |
| `RISK_FULL_REFRESH_MS` | `300000` | the whole snapshot is resent this often as a safety net |
| `RISK_TARGET_RETRY_MS` | `10000` | recheck of a reached target held back by min trading days |
| `RISK_RETRY_MS` | `2000` | retry spacing for a failed event call or a fill without enough margin |
| `RISK_CONCURRENCY` | `4` | accounts marked in parallel when events need database calls |
| `RISK_MAX_TICKS` | `250` | most equity writes in one cycle (bounds row-lock time on a large book) |

### Rollback

- Worker only: set `RISK_ENGINE=legacy` and restart. No database change needed.
- The worker also falls back to the legacy loop by itself when `risk_cycle` is not in the database.
- Database: `supabase/rollbacks/20261127090000_engine_v4_fewer_writes.down.sql` restores the previous
  `apply_risk_tick` (run it after switching the worker to legacy).

## Layout

- `rules.ts`: SL/TP, pending-order triggers, breach floors, profit target, breach/pass marks.
- `valuation.ts`: close-side fills, gross/net PnL (USD), margin, equity. Mirrors the client.
- `prices.ts`: independent ingestion (Binance for crypto, Tiingo for FX and gold, Twelve Data for WTI).
- `engine.ts`: engine v4. `legacy.ts`: the pre-v4 loop.
- `db.ts`: service-role Supabase client and the database calls. `types.ts`: shared shapes.
- `worker.ts`: entrypoint (WS price server, ingestion, engine selection).

## Run

```bash
cd "server/risk-worker"
cp .env.example .env   # fill SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
npm install
npm run dev
```

## Tests

```bash
npm test                                # engine v4 vs the legacy loop on real SQL (PGlite)
cd ../../supabase/tests/engine-v4 && npm install && npm test   # the migration vs the live apply_risk_tick
```

## Important

- `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS. Keep it on the server only, never in any `NEXT_PUBLIC_*`
  variable or the browser bundle.
