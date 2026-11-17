import { NextResponse } from "next/server"
import { createSupabaseServiceClient } from "@/lib/supabase/service"
import { verifyAdminApiKey } from "@/lib/admin-api-key"

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

    const body = await request.json()
    const { userId, accountSize, rules, programKey, phase, status, label } = body
    const size = Number(accountSize)

    if (!userId || !Number.isFinite(size) || size <= 0 || !rules) {
      return NextResponse.json({ error: "userId, a positive accountSize and rules are required" }, { status: 400 })
    }

    const terminalPhase = phase === "funded" ? "funded" : "challenge"
    const accountStatus = terminalPhase === "funded" || status === "funded" ? "funded" : "active"
    const leverage = Math.min(500, Math.max(1, Math.round(Number(body.leverage) || 100)))

    const supabase = createSupabaseServiceClient()
    const { data: newAccount, error: createError } = await supabase
      .from("accounts")
      .insert({
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

    if (createError) return NextResponse.json({ error: createError.message }, { status: 422 })
    return NextResponse.json({ success: true, account: newAccount })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
