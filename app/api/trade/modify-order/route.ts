import { NextResponse } from "next/server"
import { requireUser } from "../_auth"
import { createSupabaseServiceClient } from "@/lib/supabase/service"

/** Update SL/TP on a working pending order. NULL clears the level. */
export async function POST(request: Request) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response

  let body: { orderId?: string; stopLoss?: number | null; takeProfit?: number | null }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  if (!body.orderId) {
    return NextResponse.json({ error: "orderId required" }, { status: 400 })
  }

  const supabase = createSupabaseServiceClient()

  // Ownership check: the order must belong to one of the caller's accounts.
  const { data: order, error: lookupError } = await supabase
    .from("orders")
    .select("id, status, account_id, accounts!inner(user_id)")
    .eq("id", body.orderId)
    .maybeSingle()
  if (lookupError) return NextResponse.json({ error: lookupError.message }, { status: 422 })
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 })

  const ownerId = (order as { accounts?: { user_id?: string } }).accounts?.user_id
  if (ownerId !== auth.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (order.status !== "working") {
    return NextResponse.json({ error: `Order is ${order.status} — cannot modify` }, { status: 422 })
  }

  // Update SL/TP directly on the orders table (service_role bypasses RLS).
  const { error: updateError } = await supabase
    .from("orders")
    .update({
      stop_loss: body.stopLoss ?? null,
      take_profit: body.takeProfit ?? null,
    })
    .eq("id", body.orderId)

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 422 })
  return NextResponse.json({ ok: true })
}
