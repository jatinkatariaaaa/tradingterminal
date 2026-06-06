import { NextResponse } from "next/server"
import { requireUser } from "../_auth"
import { createSupabaseServiceClient } from "@/lib/supabase/service"
import { categoryOf } from "@/lib/trading/category"
import { isMarketOpen } from "@/lib/trading/market-hours"

/**
 * Place a PENDING order (limit or stop). The order is inserted as 'working';
 * the risk worker fills it when the trigger price is crossed. We record the
 * current server price as placed_price so the worker can verify a genuine
 * cross before filling.
 *
 * No margin/spread computation happens here — the worker handles that at fill
 * time via fill_order().
 */
export async function POST(request: Request) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response

  let body: {
    accountId?: string
    symbol?: string
    direction?: "buy" | "sell"
    kind?: "limit" | "stop"
    volume?: number
    triggerPrice?: number
    stopLoss?: number | null
    takeProfit?: number | null
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { accountId, symbol, direction, kind, volume, triggerPrice } = body
  if (
    !accountId ||
    !symbol ||
    (direction !== "buy" && direction !== "sell") ||
    (kind !== "limit" && kind !== "stop") ||
    !volume ||
    volume <= 0 ||
    !triggerPrice ||
    triggerPrice <= 0
  ) {
    return NextResponse.json(
      { error: "accountId, symbol, direction, kind, positive volume, positive triggerPrice required" },
      { status: 400 },
    )
  }

  const category = categoryOf(symbol)
  if (!isMarketOpen(category)) {
    return NextResponse.json({ error: "Market is closed for this asset class." }, { status: 400 })
  }

  const supabase = createSupabaseServiceClient()

  // Ownership check: the account must belong to the caller.
  const { data: account, error: acctError } = await supabase
    .from("accounts")
    .select("id, user_id, status")
    .eq("id", accountId)
    .maybeSingle()
  if (acctError) return NextResponse.json({ error: acctError.message }, { status: 422 })
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 })
  if (account.user_id !== auth.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (account.status !== "active" && account.status !== "funded") {
    return NextResponse.json(
      { error: `Account is ${account.status} — trading is closed` },
      { status: 422 },
    )
  }

  // Server price: used as placed_price so the worker verifies a genuine cross.
  const { data: priceRow, error: priceError } = await supabase
    .from("prices")
    .select("price")
    .eq("symbol", symbol)
    .maybeSingle()
  if (priceError) return NextResponse.json({ error: priceError.message }, { status: 422 })
  if (!priceRow) {
    return NextResponse.json({ error: `No server price for ${symbol}` }, { status: 422 })
  }

  // Insert the pending order (service_role bypasses RLS).
  const { data: order, error: insertError } = await supabase
    .from("orders")
    .insert({
      account_id: accountId,
      symbol,
      direction,
      kind,
      volume,
      trigger_price: triggerPrice,
      placed_price: priceRow.price,
      stop_loss: body.stopLoss ?? null,
      take_profit: body.takeProfit ?? null,
      status: "working",
    })
    .select()
    .single()
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 422 })
  return NextResponse.json({ order })
}
