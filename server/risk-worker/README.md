# Terminal risk worker

Run this service continuously alongside the Next.js terminal. It receives trades from Binance for crypto, quotes from Tiingo for FX and gold, and quotes from Twelve Data for WTI. It publishes observed prices to Supabase and evaluates working orders, stops and account limits.

## Configure and start

Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` on the worker. Set `TIINGO_API_KEY` for FX and gold and `TWELVEDATA_API_KEY` for WTI. Configure the website callback with `CRM_WEBHOOK_URL` and `TERMINAL_WEBHOOK_SECRET`. The worker listens on `PORT` or `WS_PORT`, defaulting to 8080.

```sh
cd server/risk-worker
npm ci
npm run typecheck
npm start
```

The terminal web app needs its own `TWELVE_DATA_KEY` or `TWELVEDATA_API_KEY` for historical charts. Set `NEXT_PUBLIC_WS_URL` to the worker's public secure WebSocket URL for streaming ticks. The browser also polls the terminal quote API.

Apply the terminal migrations including `20261121053639_trusted_terminal_prices_and_provisioning.sql` before rolling out the updated worker and web app. Set service credentials only in the server environments.

## Check the feed

`GET /api/health` returns 200 when all listed instruments in an open session have a valid quote from the last 120 seconds. Its 503 response lists missing or stale symbols. Scheduled closed markets are excluded from readiness. A fresh crypto quote cannot hide a missing FX feed.

If prices stop, check the worker process and its subscription, connection and database publication messages. Confirm the provider allows the configured instruments and the server can reach its WebSocket endpoint. The database timestamp records the provider event time. The worker pauses price-dependent risk decisions while any required quote or USD conversion is missing.
