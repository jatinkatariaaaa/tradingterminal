import { NextResponse } from "next/server"
import { requireUser } from "../_auth"
import { createSupabaseServiceClient } from "@/lib/supabase/service"
import { categoryOf } from "@/lib/trading/category"

/**
 * Close a whole position at the current SERVER price. The client sends only the
 * positionId + its symbol (to pick the spread model); the exit fill and PnL are
 * computed in SQL from public.prices, and ownership is re-verified there.
 */
export async function POST(request: Request) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response

  let body: { positionId?: string; symbol?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  if (!body.positionId || !body.symbol) {
    return NextResponse.json({ error: "positionId and symbol required" }, { status: 400 })
  }

  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase.rpc("close_position_at_market", {
    p_user_id: auth.userId,
    p_position_id: body.positionId,
    p_category: categoryOf(body.symbol),
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 422 })
  return NextResponse.json({ trade: data })
}
