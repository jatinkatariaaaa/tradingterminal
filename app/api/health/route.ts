import { NextResponse } from "next/server"
import { createSupabaseServiceClient } from "@/lib/supabase/service"
import { summarizeFeed } from "@/lib/trading/quote-health"

export const dynamic = "force-dynamic"

/**
 * Liveness for the CRM's "Test connection" and for uptime checks. Reports how
 * fresh the server prices are, since every fill depends on them.
 */
export async function GET() {
  try {
    const supabase = createSupabaseServiceClient()
    const { data, error } = await supabase.from("prices").select("symbol,price,updated_at")
    if (error) throw error
    const status = summarizeFeed(data)
    return NextResponse.json(status, { status: status.ok ? 200 : 503 })
  } catch {
    return NextResponse.json({ ...summarizeFeed([]), error: "Price feed unavailable" }, { status: 503 })
  }
}
