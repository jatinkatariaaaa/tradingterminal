// Minimal asset matrix for the worker. Kept standalone (rather than importing
// the Next.js app's lib/trading/assets.ts) so the service has no dependency on
// the web bundle. Keep the per-asset fields in sync with the app's ASSETS when
// instruments change. Only the fields the risk engine needs are included.

export type AssetCategory = "forex" | "crypto" | "commodities"
export type FeedSource = "binance" | "finnhub"

export interface WorkerAsset {
  symbol: string
  category: AssetCategory
  feed: FeedSource
  /** Binance combined-stream symbol (crypto). */
  binanceSymbol?: string
  /** Twelve Data symbol (forex/metals/energy). */
  twelveDataSymbol?: string
  digits: number
  contractSize: number
  basePrice: number
}

export const ASSETS: WorkerAsset[] = [
  // Forex
  { symbol: "EURUSD", category: "forex", feed: "finnhub", twelveDataSymbol: "EUR/USD", digits: 5, contractSize: 100_000, basePrice: 1.165 },
  { symbol: "GBPUSD", category: "forex", feed: "finnhub", twelveDataSymbol: "GBP/USD", digits: 5, contractSize: 100_000, basePrice: 1.343 },
  { symbol: "USDJPY", category: "forex", feed: "finnhub", twelveDataSymbol: "USD/JPY", digits: 3, contractSize: 100_000, basePrice: 156.4 },
  { symbol: "AUDUSD", category: "forex", feed: "finnhub", twelveDataSymbol: "AUD/USD", digits: 5, contractSize: 100_000, basePrice: 0.662 },
  { symbol: "USDCAD", category: "forex", feed: "finnhub", twelveDataSymbol: "USD/CAD", digits: 5, contractSize: 100_000, basePrice: 1.368 },
  { symbol: "USDCHF", category: "forex", feed: "finnhub", twelveDataSymbol: "USD/CHF", digits: 5, contractSize: 100_000, basePrice: 0.806 },
  { symbol: "NZDUSD", category: "forex", feed: "finnhub", twelveDataSymbol: "NZD/USD", digits: 5, contractSize: 100_000, basePrice: 0.607 },
  { symbol: "EURGBP", category: "forex", feed: "finnhub", twelveDataSymbol: "EUR/GBP", digits: 5, contractSize: 100_000, basePrice: 0.867 },
  { symbol: "EURJPY", category: "forex", feed: "finnhub", twelveDataSymbol: "EUR/JPY", digits: 3, contractSize: 100_000, basePrice: 182.2 },
  { symbol: "GBPJPY", category: "forex", feed: "finnhub", twelveDataSymbol: "GBP/JPY", digits: 3, contractSize: 100_000, basePrice: 210.1 },
  { symbol: "EURCHF", category: "forex", feed: "finnhub", twelveDataSymbol: "EUR/CHF", digits: 5, contractSize: 100_000, basePrice: 0.939 },
  { symbol: "AUDJPY", category: "forex", feed: "finnhub", twelveDataSymbol: "AUD/JPY", digits: 3, contractSize: 100_000, basePrice: 103.5 },
  { symbol: "CHFJPY", category: "forex", feed: "finnhub", twelveDataSymbol: "CHF/JPY", digits: 3, contractSize: 100_000, basePrice: 194.0 },
  { symbol: "EURAUD", category: "forex", feed: "finnhub", twelveDataSymbol: "EUR/AUD", digits: 5, contractSize: 100_000, basePrice: 1.760 },
  { symbol: "GBPAUD", category: "forex", feed: "finnhub", twelveDataSymbol: "GBP/AUD", digits: 5, contractSize: 100_000, basePrice: 2.029 },
  { symbol: "USDSGD", category: "forex", feed: "finnhub", twelveDataSymbol: "USD/SGD", digits: 5, contractSize: 100_000, basePrice: 1.286 },
  { symbol: "USDMXN", category: "forex", feed: "finnhub", twelveDataSymbol: "USD/MXN", digits: 4, contractSize: 100_000, basePrice: 18.62 },
  { symbol: "USDZAR", category: "forex", feed: "finnhub", twelveDataSymbol: "USD/ZAR", digits: 4, contractSize: 100_000, basePrice: 17.85 },

  // Crypto
  { symbol: "BTC/USD", category: "crypto", feed: "binance", binanceSymbol: "BTCUSDT", digits: 2, contractSize: 1, basePrice: 73700 },
  { symbol: "ETH/USD", category: "crypto", feed: "binance", binanceSymbol: "ETHUSDT", digits: 2, contractSize: 1, basePrice: 2700 },

  // Commodities
  { symbol: "XAUUSD", category: "commodities", feed: "finnhub", twelveDataSymbol: "XAU/USD", digits: 2, contractSize: 100, basePrice: 4495 },
  { symbol: "USOIL", category: "commodities", feed: "finnhub", twelveDataSymbol: "WTI/USD", digits: 2, contractSize: 1000, basePrice: 94.1 },
]

export const ASSET_MAP: Record<string, WorkerAsset> = Object.fromEntries(
  ASSETS.map((a) => [a.symbol, a]),
)
