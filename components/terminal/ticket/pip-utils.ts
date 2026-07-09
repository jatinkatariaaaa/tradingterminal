import { getAsset } from "@/lib/trading/assets"

/**
 * Pip size for an asset: for FX, one pip is the 2nd-to-last quoted digit
 * (0.0001 on 5-digit pairs, 0.01 on 3-digit JPY pairs). For non-FX assets we
 * treat one "pip" as one full point of the 2nd-to-last digit as well, which
 * matches how cTrader displays pip-based distances across asset classes.
 */
export function pipSizeOf(symbol: string): number {
  const asset = getAsset(symbol)
  return Math.pow(10, -(asset.digits - 1))
}

/** Convert an absolute price distance to pips for a symbol. */
export function priceToPips(symbol: string, distance: number): number {
  return distance / pipSizeOf(symbol)
}

/** Convert a pip distance to an absolute price distance for a symbol. */
export function pipsToPrice(symbol: string, pips: number): number {
  return pips * pipSizeOf(symbol)
}

/** Round a price to the asset's quoted precision. */
export function roundToDigits(symbol: string, price: number): number {
  const asset = getAsset(symbol)
  return Number(price.toFixed(asset.digits))
}
