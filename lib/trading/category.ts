// Shared symbol -> asset-category helper used by the trade API so the server
// SQL (open_market_position / close_position_at_market) gets the right spread
// model. Kept tiny and dependency-free so both client and server can import it.

import { ASSET_MAP } from "./assets"
import type { AssetCategory } from "./types"

export function categoryOf(symbol: string): AssetCategory {
  return ASSET_MAP[symbol]?.category ?? "forex"
}
