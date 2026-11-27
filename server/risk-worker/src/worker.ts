// Risk worker entrypoint.
//
// RISK_ENGINE=v4 (default): risk engine v4 (src/engine.ts). The same rules as before, marked in memory on
//   every tick; the database gets one risk_cycle request per cycle plus the trading events themselves.
// RISK_ENGINE=legacy: the loop as it ran before engine v4 (src/legacy.ts). Also used automatically when the
//   database does not have risk_cycle yet, so the worker can be deployed before or after the migration.

import "./preload.js"
import { getPrice, getPrices, realPriceReceived, startIngestion } from "./prices.js"
import { startWsServer } from "./ws-server.js"
import { liveDb } from "./db.js"
import { postCrmWebhook } from "./crm.js"
import { LegacyEngine } from "./legacy.js"
import { configFromEnv, MissingCycleRpc, RiskEngine } from "./engine.js"
import type { PriceFeed } from "./types.js"

const TICK_MS = Number(process.env.RISK_TICK_MS ?? "500")
const FX_POLL_MS = Number(process.env.FINNHUB_POLL_MS ?? process.env.FX_POLL_MS ?? "15000")
const MODE = (process.env.RISK_ENGINE ?? "v4").toLowerCase()

const feed: PriceFeed = {
  get: getPrice,
  all: getPrices,
  isReal: (symbol) => realPriceReceived.has(symbol),
}

function runLegacy(reason: string): void {
  console.log(`risk-worker: legacy loop (${reason}), ticking every ${TICK_MS}ms`)
  new LegacyEngine(liveDb, feed, postCrmWebhook).start(TICK_MS)
}

async function main(): Promise<void> {
  const wsPort = Number(process.env.PORT || process.env.WS_PORT || 8080)
  startWsServer(wsPort)

  console.log("risk-worker: starting ingestion…")
  await startIngestion(FX_POLL_MS)

  if (MODE === "legacy") return runLegacy("RISK_ENGINE=legacy")

  const cfg = configFromEnv(process.env)
  const engine = new RiskEngine(liveDb, feed, postCrmWebhook, cfg)
  console.log(
    `risk-worker: engine v4, marking every ${cfg.tickMs}ms, cycle every ${cfg.cycleMs}ms (${cfg.idleCycleMs}ms while flat)`,
  )

  let last = { ...engine.stats }
  setInterval(() => {
    const s = engine.stats
    console.log(
      `[engine] last 60s: ${s.cycles - last.cycles} cycles, ${s.ticksSent - last.ticksSent} equity writes sent, ` +
        `${s.pricesSent - last.pricesSent} prices, ${s.events - last.events} events, ${s.errors - last.errors} errors`,
    )
    last = { ...s }
  }, 60_000).unref()

  const stop = async (signal: string) => {
    console.log(`risk-worker: ${signal}, sending pending marks`)
    try {
      await engine.flush()
    } finally {
      process.exit(0)
    }
  }
  process.once("SIGTERM", () => void stop("SIGTERM"))
  process.once("SIGINT", () => void stop("SIGINT"))

  try {
    await engine.run()
  } catch (err) {
    if (err instanceof MissingCycleRpc) return runLegacy("risk_cycle is not in the database yet")
    throw err
  }
}

void main()
