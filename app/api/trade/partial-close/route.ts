import { NextResponse } from "next/server"
import { requireUser } from "../_auth"
import { createSupabaseServiceClient } from "@/lib/supabase/service"

export async function POST(request: Request) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response

  let body: { positionId?: string; symbol?: string; volume?: number }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  
  if (!body?.positionId || typeof body.volume !== "number") {
    return NextResponse.json({ error: "positionId and numeric volume required" }, { status: 400 })
  }

  if (!Number.isFinite(body.volume) || body.volume <= 0) {
    return NextResponse.json({ error: "Close volume must be positive" }, { status: 400 })
  }

  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase.rpc("partial_close_position_at_market", {
    p_user_id: auth.userId,
    p_position_id: body.positionId,
    p_close_volume: body.volume,
  })
  
  if (error) return NextResponse.json({ error: error.message }, { status: 422 })
  return NextResponse.json({ trade: data })
}
