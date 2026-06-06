import WebSocket from "ws"
import { ASSETS, ASSET_MAP, isMarketOpen } from "./assets.js"
import { broadcastPrice } from "./ws-server.js"

const latest: Record<string, number> = {}

export function getPrice(symbol: string): number | undefined {
  return latest[symbol]
}

export function getPrices(): Record<string, number> {
  return { ...latest }
}

// ------------------------------------------------------------------ Binance
function startBinance(): void {
  const tracked = ASSETS.filter((a) => a.feed === "binance" && a.binanceSymbol)
  if (tracked.length === 0) return

  const reverseMap: Record<string, string> = {}
  tracked.forEach(a => {
    if (a.binanceSymbol) reverseMap[a.binanceSymbol] = a.symbol
  })

  // Build the combined stream URL for instantaneous aggTrades
  const streams = tracked.map(a => `${a.binanceSymbol!.toLowerCase()}@aggTrade`).join("/")
  const BINANCE_URL = `wss://stream.binance.com:9443/stream?streams=${streams}`

  let ws: WebSocket | null = null
  let reconnect: NodeJS.Timeout | null = null

  const connect = () => {
    ws = new WebSocket(BINANCE_URL)
    
    ws.on("open", () => {
      console.log("Binance WebSocket connected.")
    })

    ws.on("message", (raw) => {
      try {
        const payload = JSON.parse(raw.toString())
        if (!payload.data) return

        const data = payload.data
        const sym = data.s
        if (typeof sym === "string") {
          const price = Number.parseFloat(data.p) // 'p' is the price in aggTrade
          if (Number.isFinite(price)) {
            const internalSymbol = reverseMap[sym]
            if (internalSymbol) {
              latest[internalSymbol] = price
              broadcastPrice(internalSymbol, price)
            }
          }
        }
      } catch {
        // ignore malformed frames
      }
    })

    ws.on("close", (code, reason) => {
      console.log(`Binance WebSocket closed (${code}: ${reason}). Reconnecting in 2s...`)
      if (!reconnect) reconnect = setTimeout(() => { reconnect = null; connect() }, 2000)
    })
    
    ws.on("error", (err) => {
      console.error("Binance WebSocket error:", err)
      ws?.close()
    })
  }
  connect()
}

const TIINGO_WS_URL = "wss://api.tiingo.com/fx"

function startTiingo(): void {
  const TIINGO_KEY = process.env.TIINGO_API_KEY ?? ""
  console.log("Checking API Key:", !!TIINGO_KEY)

  // Tiingo FX WS only supports Forex and Precious Metals. WTI/Crypto will crash it.
  const targets = ASSETS.filter((a) => a.feed === "finnhub" && (a.category === "forex" || a.symbol === "XAUUSD"))
  if (targets.length === 0) return

  // Build reverse map to quickly find internal symbol from Tiingo symbol
  // Tiingo symbols are lowercase, no slashes (e.g. eurusd, xauusd)
  const reverseMap: Record<string, string> = {}
  const tiingoTickers: string[] = []

  targets.forEach((a) => {
    const tTicker = a.symbol.toLowerCase()
    tiingoTickers.push(tTicker)
    reverseMap[tTicker] = a.symbol
  })

  let ws: WebSocket | null = null
  let reconnect: NodeJS.Timeout | null = null

  const connect = () => {
    ws = new WebSocket(TIINGO_WS_URL)
    
    ws.on("open", () => {
      console.log("Tiingo WebSocket connected. Subscribing to targets...")
      ws?.send(JSON.stringify({
        eventName: "subscribe",
        authorization: TIINGO_KEY,
        eventData: {
          thresholdLevel: 5,
          tickers: tiingoTickers
        }
      }))
    })

    ws.on("message", (raw) => {
      try {
        const payload = JSON.parse(raw.toString())
        
        if (payload.messageType === "I") {
          console.log("Tiingo info:", payload)
          return
        }

        // Tiingo FX WS sends { messageType: 'A', service: 'fx', data: ["Q", "eurusd", "2021-01-...", bid, bidSize, ask, askSize, mid] }
        let msgArray = Array.isArray(payload) ? payload : payload.data
        if (!Array.isArray(msgArray)) return
        
        const type = msgArray[0]
        if (type === "Q" || type === "A") {
          const ticker = msgArray[1]
          // index 7 is midPrice. if missing, fallback to bidPrice (index 3)
          const midPrice = msgArray[7] ?? msgArray[3] 
          
          if (typeof ticker === "string" && typeof midPrice === "number") {
            const internalSymbol = reverseMap[ticker.toLowerCase()]
            if (internalSymbol) {
              const asset = ASSET_MAP[internalSymbol]
              if (asset && !isMarketOpen(asset.category)) return // Block closed market ticks
              latest[internalSymbol] = midPrice
              broadcastPrice(internalSymbol, midPrice)
            }
          }
        }
      } catch {
        // ignore malformed frames
      }
    })

    ws.on("close", (code, reason) => {
      console.log(`Tiingo WebSocket closed (${code}: ${reason}). Reconnecting in 2s...`)
      if (!reconnect) reconnect = setTimeout(() => { reconnect = null; connect() }, 2000)
    })
    ws.on("error", (err) => {
      console.error("Tiingo WebSocket error:", err)
      ws?.close()
    })
  }
  connect()
}

// ----------------------------------------------------------------- Twelve Data (WTI/USD Only)
function startTwelveData(): void {
  const TWELVEDATA_KEY = process.env.TWELVEDATA_API_KEY ?? ""
  const TWELVEDATA_WS_URL = `wss://ws.twelvedata.com/v1/quotes/price?apikey=${TWELVEDATA_KEY}`

  // Ensure we only subscribe to USOIL (WTI/USD) to bypass 2-symbol limit safely.
  const usoilAsset = ASSETS.find(a => a.symbol === "USOIL")
  if (!usoilAsset || !usoilAsset.twelveDataSymbol) return

  let ws: WebSocket | null = null
  let reconnect: NodeJS.Timeout | null = null

  const connect = () => {
    ws = new WebSocket(TWELVEDATA_WS_URL)
    
    ws.on("open", () => {
      console.log("Twelve Data WebSocket connected (WTI/USD Only).")
      ws?.send(JSON.stringify({
        action: "subscribe",
        params: { symbols: usoilAsset.twelveDataSymbol }
      }))
    })

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString())
        if (msg.event === "price" && msg.symbol === usoilAsset.twelveDataSymbol && typeof msg.price === "number") {
          if (!isMarketOpen(usoilAsset.category)) return // Block closed market ticks
          latest["USOIL"] = msg.price
          broadcastPrice("USOIL", msg.price)
        } else if (msg.event === "error") {
          console.error("Twelve Data WebSocket error:", msg)
        }
      } catch {
        // ignore malformed frames
      }
    })

    ws.on("close", (code, reason) => {
      console.log(`Twelve Data WebSocket closed (${code}: ${reason}). Reconnecting in 2s...`)
      if (!reconnect) reconnect = setTimeout(() => { reconnect = null; connect() }, 2000)
    })
    ws.on("error", (err) => {
      console.error("Twelve Data WebSocket error:", err)
      ws?.close()
    })
  }
  connect()
}

/** Start all ingestion. Resolves once the sockets are spun up. */
export async function startIngestion(fxPollMs: number): Promise<void> {
  startBinance()
  startTiingo()
  startTwelveData()

  // Seed default prices if websockets are temporarily unavailable
  for (const a of ASSETS) {
    if (latest[a.symbol] === undefined) {
      latest[a.symbol] = a.basePrice
    }
  }
}

export { ASSET_MAP }
