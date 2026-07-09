import type { Asset, Direction } from "./types"

// Master asset matrix.
//  - Crypto pulls live prices from the public Binance !ticker@arr stream (all pairs, one socket).
//  - Forex & metals are anchored to real prices from the massive.com API and kept
//    live by the internal 500ms simulator.
//  - Energy is pure simulation.
// No registration or API keys are required from the end user.

const fx = (
  symbol: string,
  label: string,
  basePrice: number,
  digits: number,
): Asset => ({
  symbol,
  label,
  category: "forex",
  feed: "massive",
  massiveTicker: `C:${symbol}`,
  yahooTicker: `${symbol}=X`,
  basePrice,
  digits,
  contractSize: 100_000,
  lotStep: 0.01,
})

const crypto = (
  symbol: string,
  label: string,
  binanceStream: string,
  basePrice: number,
  digits: number,
): Asset => ({
  symbol,
  label,
  category: "crypto",
  feed: "binance",
  binanceStream,
  basePrice,
  digits,
  contractSize: 1,
  lotStep: 0.01,
})

export const ASSETS: Asset[] = [
  // ---------------------------------------------------------------- Forex
  fx("EURUSD", "Euro / US Dollar", 1.144, 5),
  fx("GBPUSD", "British Pound / US Dollar", 1.343, 5),
  fx("USDJPY", "US Dollar / Japanese Yen", 156.4, 3),
  fx("USDCHF", "US Dollar / Swiss Franc", 0.806, 5),
  fx("AUDUSD", "Australian / US Dollar", 0.662, 5),
  fx("USDCAD", "US Dollar / Canadian Dollar", 1.368, 5),
  fx("NZDUSD", "New Zealand / US Dollar", 0.607, 5),
  fx("EURGBP", "Euro / British Pound", 0.867, 5),
  fx("EURJPY", "Euro / Japanese Yen", 182.2, 3),
  fx("GBPJPY", "British Pound / Japanese Yen", 210.1, 3),
  fx("EURCHF", "Euro / Swiss Franc", 0.939, 5),
  fx("AUDJPY", "Australian Dollar / Yen", 103.5, 3),
  fx("CHFJPY", "Swiss Franc / Japanese Yen", 194.0, 3),
  fx("EURAUD", "Euro / Australian Dollar", 1.760, 5),
  fx("GBPAUD", "British Pound / Aussie Dollar", 2.029, 5),
  fx("USDSGD", "US Dollar / Singapore Dollar", 1.286, 5),
  fx("USDMXN", "US Dollar / Mexican Peso", 18.62, 4),
  fx("USDZAR", "US Dollar / South African Rand", 17.85, 4),

  // --------------------------------------------------------------- Crypto
  crypto("BTC/USD", "Bitcoin / USD", "BTCUSDT", 73700, 2),
  crypto("ETH/USD", "Ethereum / USD", "ETHUSDT", 2700, 2),

  // ----------------------------------------------------------- Commodities
  {
    symbol: "XAUUSD",
    label: "Gold / US Dollar",
    category: "commodities",
    feed: "massive",
    massiveTicker: "C:XAUUSD",
    yahooTicker: "GC=F",
    basePrice: 4495,
    digits: 2,
    contractSize: 100, // 100 oz per lot
    lotStep: 0.01,
  },
  // {
  //   symbol: "XAGUSD",
  //   label: "Silver / US Dollar",
  //   category: "commodities",
  //   feed: "massive",
  //   massiveTicker: "C:XAGUSD",
  //   yahooTicker: "SI=F",
  //   basePrice: 74.8,
  //   digits: 3,
  //   contractSize: 5000, // 5,000 oz per lot
  //   lotStep: 0.01,
  // },
  // {
  //   symbol: "XPTUSD",
  //   label: "Platinum / US Dollar",
  //   category: "commodities",
  //   feed: "massive",
  //   massiveTicker: "C:XPTUSD",
  //   yahooTicker: "PL=F",
  //   basePrice: 1932,
  //   digits: 2,
  //   contractSize: 100,
  //   lotStep: 0.01,
  // },
  // {
  //   symbol: "XPDUSD",
  //   label: "Palladium / US Dollar",
  //   category: "commodities",
  //   feed: "massive",
  //   massiveTicker: "C:XPDUSD",
  //   yahooTicker: "PA=F",
  //   basePrice: 1379,
  //   digits: 2,
  //   contractSize: 100,
  //   lotStep: 0.01,
  // },
  // {
  //   symbol: "USOIL",
  //   label: "WTI Crude Oil",
  //   category: "commodities",
  //   feed: "massive",
  //   yahooTicker: "CL=F",
  //   basePrice: 94.1,
  //   digits: 2,
  //   contractSize: 1000, // 1,000 barrels per lot
  //   lotStep: 0.01,
  // },
  // {
  //   symbol: "UKOIL",
  //   label: "Brent Crude Oil",
  //   category: "commodities",
  //   feed: "massive",
  //   yahooTicker: "BZ=F",
  //   basePrice: 97.2,
  //   digits: 2,
  //   contractSize: 1000,
  //   lotStep: 0.01,
  // },
  // {
  //   symbol: "NATGAS",
  //   label: "Natural Gas",
  //   category: "commodities",
  //   feed: "massive",
  //   yahooTicker: "NG=F",
  //   basePrice: 3.18,
  //   digits: 3,
  //   contractSize: 10000,
  //   lotStep: 0.01,
  // },
]

export const ASSET_MAP: Record<string, Asset> = Object.fromEntries(
  ASSETS.map((a) => [a.symbol, a]),
)

export const CATEGORY_LABELS: Record<Asset["category"], string> = {
  forex: "Forex",
  crypto: "Crypto",
  commodities: "Commodities",
}

export function getAsset(symbol: string): Asset {
  return ASSET_MAP[symbol] ?? ASSETS[0]
}

/**
 * Resolve the Yahoo Finance chart ticker for an asset (for real OHLC history).
 *  - Forex / metals / energy: use the configured `yahooTicker` (e.g. "EURUSD=X", "GC=F").
 *  - Crypto: derive from the symbol — "BTCUSDT" → "BTC-USD", which Yahoo serves
 *    even where the Binance API is geo-blocked.
 * Returns null when no real source is known.
 */
export function yahooChartTicker(asset: Asset): string | null {
  if (asset.yahooTicker) return asset.yahooTicker
  if (asset.category === "crypto") {
    const base = asset.symbol.replace(/USDT$/, "").replace(/\/USD$/, "")
    return base ? `${base}-USD` : null
  }
  return null
}

/**
 * Map an internal asset to a TwelveData-compatible symbol for candle / quote APIs.
 * Returns null when no mapping is known.
 */
const TWELVEDATA_COMMODITY_MAP: Record<string, string> = {
  XAUUSD: "XAU/USD",
  XAGUSD: "XAG/USD",
  XPTUSD: "XPT/USD",
  XPDUSD: "XPD/USD",
  USOIL: "WTI/USD",
  UKOIL: "BRENT/USD",
  NATGAS: "NATGAS/USD",
}

export function twelveDataSymbol(asset: Asset): string | null {
  if (TWELVEDATA_COMMODITY_MAP[asset.symbol]) {
    return TWELVEDATA_COMMODITY_MAP[asset.symbol]
  }
  if (asset.category === "crypto") {
    const base = asset.symbol.replace(/USDT$/, "").replace(/\/USD$/, "")
    return base ? `${base}/USD` : null
  }
  if (asset.category === "forex" && asset.symbol.length === 6) {
    const base = asset.symbol.slice(0, 3)
    const quote = asset.symbol.slice(3)
    return `${base}/${quote}`
  }
  return null
}

// Format a price using the asset's configured decimal precision.
export function formatPrice(price: number, digits: number): string {
  return price.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function formatMoney(value: number): string {
  const sign = value < 0 ? "-" : ""
  return `${sign}$${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

/**
 * The quote (right-hand) currency a symbol's raw P&L is denominated in.
 *  - Crypto pairs (…USDT) and any …USD symbol settle in USD.
 *  - Standard 6-char FX crosses use the trailing 3 chars (USDJPY → JPY).
 *  - Everything else (NATGAS, USOIL, UKOIL) is quoted in USD.
 */
export function quoteCurrencyOf(symbol: string): string {
  if (symbol.endsWith("USDT")) return "USD"
  if (symbol.endsWith("USD")) return "USD"
  if (symbol.length === 6) return symbol.slice(3)
  return "USD"
}

/**
 * USD value of one unit of `currency`, derived from the live price map. Uses a
 * direct pair (e.g. GBPUSD) when available, otherwise the inverse (e.g. USDJPY).
 * Falls back to 1 when no conversion pair is present so P&L never becomes NaN.
 */
export function usdPerUnit(currency: string, prices: Record<string, number>): number {
  if (currency === "USD") return 1
  const direct = prices[`${currency}USD`]
  if (Number.isFinite(direct) && direct > 0) return direct
  const inverse = prices[`USD${currency}`]
  if (Number.isFinite(inverse) && inverse > 0) return 1 / inverse
  return 1
}

// ----------------------------------------------------------------------------
// Institutional execution mechanics: spread, commission, leverage and margin.
// ----------------------------------------------------------------------------

/** Account leverage applied to every instrument (1:100). */
export const LEVERAGE = 100

/** Commission charged per lot, per side (USD). A round-turn costs 2x this. */
export const COMMISSION_PER_LOT = 3

/** Round-turn commission (entry + exit) in USD for a given lot size. */
export function commissionFor(volume: number): number {
  return COMMISSION_PER_LOT * 2 * volume
}

/** Snap a requested volume to the asset's lot step, never below one step. */
export function roundToLotStep(volume: number, lotStep: number): number {
  const steps = Math.max(1, Math.round(volume / lotStep))
  return Number((steps * lotStep).toFixed(6))
}

/**
 * Synthetic bid/ask spread in *price units* for an asset at a given mid price,
 * tuned to realistic raw-spread levels per asset class.
 */
export function spreadOf(asset: Asset, price: number): number {
  switch (asset.category) {
    case "forex": {
      // pip size: 5-digit majors → 0.0001, 3-digit JPY pairs → 0.01
      const pip = Math.pow(10, -(asset.digits - 1))
      return 1.2 * pip // ~1.2 pips
    }
    case "crypto":
      return price * 0.0002 // ~2 bps
    case "commodities":
      return price * 0.00012
    default:
      return price * 0.0001
  }
}

/** Bid / ask quotes derived from a mid price and its spread. */
export function bidAsk(mid: number, spread: number): { bid: number; ask: number } {
  const half = spread / 2
  return { bid: mid - half, ask: mid + half }
}

/** Execution price when OPENING: buys pay the ask, sells hit the bid. */
export function openFillPrice(direction: Direction, mid: number, spread: number): number {
  const half = spread / 2
  return direction === "buy" ? mid + half : mid - half
}

/** Execution price when CLOSING / marking: buys exit on the bid, sells on the ask. */
export function closeFillPrice(direction: Direction, mid: number, spread: number): number {
  const half = spread / 2
  return direction === "buy" ? mid - half : mid + half
}

/**
 * USD margin required to open `volume` lots at `fillPrice`:
 *   notionalUSD = volume * contractSize * fillPrice * (quote currency → USD)
 *   margin      = notionalUSD / LEVERAGE
 */
export function marginRequired(
  asset: Asset,
  volume: number,
  fillPrice: number,
  prices: Record<string, number>,
): number {
  const notionalUsd =
    volume * asset.contractSize * fillPrice * usdPerUnit(quoteCurrencyOf(asset.symbol), prices)
  return notionalUsd / LEVERAGE
}
