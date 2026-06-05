import { NextResponse } from "next/server"
import { requireUser } from "../_auth"
import { createSupabaseServiceClient } from "@/lib/supabase/service"
import { getAsset } from "@/lib/trading/assets"
import { categoryOf } from "@/lib/trading/category"

/**
 * Open a MARKET position. The client sends only the INTENT (account, symbol,
 * direction, volume, optional SL/TP) — NEVER a price. The fill price is derived
 * server-side from public.prices inside open_market_position(), and the SQL
 * re-verifies the user owns the account. Pending (limit/stop) orders use a
 * separate flow (inserted then filled by the worker) and are not handled here.
 */
export async function POST(request: Request) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response

  let body: {
    accountId?: string
    symbol?: string
    direction?: "buy" | "sell"
    volume?: number
    stopLoss?: number | null
    takeProfit?: number | null
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { accountId, symbol, direction, volume } = body
  if (!accountId || !symbol || (direction !== "buy" && direction !== "sell") || !volume || volume <= 0) {
    return NextResponse.json({ error: "accountId, symbol, direction, positive volume required" }, { status: 400 })
  }

  const asset = getAsset(symbol)
  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase.rpc("open_market_position", {
    p_user_id: auth.userId,
    p_account_id: accountId,
    p_symbol: symbol,
    p_direction: direction,
    p_volume: volume,
    p_contract_size: asset.contractSize,
    p_digits: asset.digits,
    p_category: categoryOf(symbol),
    p_stop_loss: body.stopLoss ?? null,
    p_take_profit: body.takeProfit ?? null,
  })
  if (error) {
    // RPC raises on insufficient margin / ownership / closed account.
    return NextResponse.json({ error: error.message }, { status: 422 })
  }
  return NextResponse.json({ position: data })
}
