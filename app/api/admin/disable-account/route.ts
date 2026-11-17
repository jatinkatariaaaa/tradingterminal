import { NextResponse } from "next/server"
import { createSupabaseServiceClient } from "@/lib/supabase/service"
import { verifyAdminApiKey } from "@/lib/admin-api-key"

/**
 * Stops trading on an account. Open positions are closed at the current server
 * price and working orders cancelled, in one transaction (admin_freeze_account).
 * Body: { login: <account id>, reason?: string, status?: "suspended" | "breached" }
 */
export async function POST(request: Request) {
  try {
    if (!(await verifyAdminApiKey(request))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { login, reason, status } = await request.json()
    if (!login) return NextResponse.json({ error: "Missing login (account id)" }, { status: 400 })

    const supabase = createSupabaseServiceClient()
    const { data, error } = await supabase.rpc("admin_freeze_account", {
      p_account_id: login,
      p_status: status === "breached" ? "breached" : "suspended",
      p_reason: typeof reason === "string" ? reason.slice(0, 300) : null,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 422 })

    return NextResponse.json({ success: true, account: data })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
