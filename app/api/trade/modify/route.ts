import { NextResponse } from "next/server"
import { requireUser } from "../_auth"
import { createSupabaseServiceClient } from "@/lib/supabase/service"

/** Update SL/TP on an owned position. NULL clears the level. */
export async function POST(request: Request) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response

  let body: { positionId?: string; stopLoss?: number | null; takeProfit?: number | null }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  if (!body.positionId) {
    return NextResponse.json({ error: "positionId required" }, { status: 400 })
  }

  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase.rpc("modify_position", {
    p_user_id: auth.userId,
    p_position_id: body.positionId,
    p_stop_loss: body.stopLoss ?? null,
    p_take_profit: body.takeProfit ?? null,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 422 })
  return NextResponse.json({ position: data })
}
