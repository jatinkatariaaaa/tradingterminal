# Risk Worker (Phase 3, Step 3a)

Standalone, server-authoritative risk engine. It ingests prices **independently**
(never trusting any browser), marks every open position on the **close side** of
the spread (bid for longs, ask for shorts), recomputes equity, fills triggered
pending orders, applies SL/TP, rolls the 5pm ET daily baseline, and fires
drawdown breaches — all by calling the `SECURITY DEFINER` functions in
`supabase/migrations/0004_risk_engine.sql` with the **service-role** key.

This is the only component (besides the Step 3b API routes) allowed to write
money, positions, and trades. The browser remains read-only.

## Why a separate service

Next.js route handlers are request-scoped; the risk engine needs a long-lived
process holding a price socket and a steady tick loop. Run it as its own Node
service (the same place your Massive.com/Socket.io feed lives — swap `prices.ts`
to consume that feed when ready).

## Layout

- `valuation.ts` — pure functions: close-side fills, gross/net PnL (USD), margin,
  equity. Mirrors the client's `floatingPnlUsd` so server and UI agree.
- `prices.ts` — independent ingestion: Binance combined WS for crypto + Yahoo
  poll for FX/metals/energy. Exposes a synchronous latest-price getter.
- `db.ts` — service-role Supabase client + typed RPC wrappers.
- `worker.ts` — the tick loop tying it together.

## Run

```bash
cd "server/risk-worker"
cp .env.example .env   # fill SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
npm install
npm run dev
```

## Important

- Requires migrations `0001`–`0004` applied first.
- `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS — keep it on the server only, never in
  any `NEXT_PUBLIC_*` variable or the browser bundle.
- Step 3a does **not** cut the client over; the existing in-browser
  `TradingProvider` keeps running. Step 3b adds the API routes and flips the UI
  to render server state.
