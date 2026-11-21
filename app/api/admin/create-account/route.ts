import { NextResponse } from "next/server"
import { createSupabaseServiceClient } from "@/lib/supabase/service"
import { verifyAdminApiKey } from "@/lib/admin-api-key"
import { createHash } from "node:crypto"

/**
 * Creates the account a trader trades on. Called by The People Prop's CRM after
 * a purchase, a passed phase or a reset; the CRM links it to its own record.
 */

function pctToDecimal(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed / 100 : fallback
}

export async function POST(request: Request) {
  try {
    if (!(await verifyAdminApiKey(request))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request" }, { status: 400 })
    const { userId, accountSize, rules, programKey, phase, status, label } = body
    const size = Number(accountSize)

    const crmId = body.businessAccountId
    if (crmId !== undefined && (typeof crmId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(crmId))) {
      return NextResponse.json({ error: "Invalid business account ID" }, { status: 400 })
    }
    if (!userId || !Number.isFinite(size) || size <= 0 || !rules || typeof rules !== "object") {
      return NextResponse.json({ error: "userId, a positive accountSize and rules are required" }, { status: 400 })
    }

    const terminalPhase = phase === "funded" ? "funded" : "challenge"
    const accountStatus = terminalPhase === "funded" || status === "funded" ? "funded" : "active"
    const leverage = Math.min(500, Math.max(1, Math.round(Number(body.leverage) || 100)))

    const supabase = createSupabaseServiceClient()
    const fingerprint = createHash("sha256").update(JSON.stringify([userId, size, programKey ?? null, terminalPhase])).digest("hex")
    const { data: newAccount, error: createError } = await supabase
      .from("accounts")
      .insert({
        ...(crmId ? { id: crmId, provisioning_fingerprint: fingerprint } : {}),
        user_id: userId,
        label: label || `TPP $${size.toLocaleString("en-US")} ${terminalPhase === "funded" ? "Funded" : "Evaluation"}`,
        phase: terminalPhase,
        status: accountStatus,
        starting_balance: size,
        balance: size,
        equity: size,
        daily_start_balance: size,
        highest_equity: size,
        max_daily_drawdown: pctToDecimal(rules.max_daily_drawdown_pct, 0.05),
        max_overall_drawdown: pctToDecimal(rules.max_overall_drawdown_pct, 0.1),
        profit_target: terminalPhase === "funded" ? 0 : pctToDecimal(rules.profit_target_pct, 0.08),
        min_trading_days: terminalPhase === "funded" ? 0 : Math.max(0, Math.round(Number(rules.min_trading_days) || 0)),
        leverage,
        program_key: programKey || null,
        // The CRM links business_account_id once its own row exists (FK order).
        business_account_id: null,
      })
      .select()
      .single()

    if (crmId && createError?.code === "23505") {
      const { data: existing, error } = await supabase.from("accounts").select("id,provisioning_fingerprint")
        .eq("id", crmId).maybeSingle()
      if (error) throw error
      if (existing?.provisioning_fingerprint !== fingerprint) {
        return NextResponse.json({ error: "Provisioning identity conflict" }, { status: 409 })
      }
      return NextResponse.json({ success: true, account: { id: existing.id } })
    }
    if (createError) return NextResponse.json({ error: createError.message }, { status: 422 })
    return NextResponse.json({ success: true, account: newAccount })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
