import { NextResponse } from "next/server"
import { requireUser } from "../_auth"
import { createSupabaseServiceClient } from "@/lib/supabase/service"

/**
 * Cancel a working pending order. We verify ownership in the route (the
 * cancel_order RPC from 0004 does not take a user id), then call it.
 */
export async function POST(request: Request) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response

  let body: { orderId?: string }
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
    .select("id, account_id, accounts!inner(user_id)")
    .eq("id", body.orderId)
    .maybeSingle()
  if (lookupError) return NextResponse.json({ error: lookupError.message }, { status: 422 })
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 })
  const ownerId = (order as { accounts?: { user_id?: string } }).accounts?.user_id
  if (ownerId !== auth.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { error } = await supabase.rpc("cancel_order", { p_order_id: body.orderId })
  if (error) return NextResponse.json({ error: error.message }, { status: 422 })
  return NextResponse.json({ ok: true })
}
