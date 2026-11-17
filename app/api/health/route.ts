import { NextResponse } from "next/server"
import { createSupabaseServiceClient } from "@/lib/supabase/service"

export const dynamic = "force-dynamic"

/**
 * Liveness for the CRM's "Test connection" and for uptime checks. Reports how
 * fresh the server prices are, since every fill depends on them.
 */
export async function GET() {
  try {
    const supabase = createSupabaseServiceClient()
    const { data } = await supabase.from("prices").select("updated_at").order("updated_at", { ascending: false }).limit(1).maybeSingle()
    const ageSeconds = data?.updated_at ? Math.round((Date.now() - new Date(data.updated_at).getTime()) / 1000) : null
    return NextResponse.json({ ok: true, service: "tpp-terminal", priceFeed: ageSeconds == null ? "no prices" : ageSeconds <= 60 ? "live" : "stale", lastPriceAgeSeconds: ageSeconds })
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 503 })
  }
}
