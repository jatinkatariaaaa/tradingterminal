import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

// Accept ADMIN_API_KEY from env, or fall back to the known CRM key
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || "tpp-admin-secret-key";
const CRM_KNOWN_KEY = "220BPHARM010";

function pctToDecimal(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed / 100 : fallback;
}

export async function POST(request: Request) {
  try {
    const apiKeyHeader = request.headers.get("x-api-key");
    const bearerToken = request.headers.get("Authorization")?.replace("Bearer ", "");
    const providedKey = apiKeyHeader || bearerToken;
    
    if (providedKey !== ADMIN_API_KEY && providedKey !== CRM_KNOWN_KEY) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { userId, accountSize, rules, programKey, phase, status, label, businessAccountId } = body;

    if (!userId || !accountSize || !rules) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const supabase = createSupabaseServiceClient();
    const terminalPhase = phase === "funded" ? "funded" : "challenge";
    const accountStatus = terminalPhase === "funded" ? "funded" : status === "funded" ? "funded" : "active";

    // The Terminal uses these fields for its internal risk worker
    const maxDailyDrawdown = pctToDecimal(rules.max_daily_drawdown_pct, 0.05);
    const maxOverallDrawdown = pctToDecimal(rules.max_overall_drawdown_pct, 0.10);
    const profitTarget = terminalPhase === "funded" ? 0 : pctToDecimal(rules.profit_target_pct, 0.08);

    const { data: newAccount, error: createError } = await supabase
      .from("accounts")
      .insert({
        user_id: userId,
        label: label || `TPP $${Number(accountSize).toLocaleString()} ${terminalPhase === "funded" ? "Funded" : "Challenge"}`,
        phase: terminalPhase,
        status: accountStatus,
        starting_balance: accountSize,
        balance: accountSize,
        equity: accountSize,
        daily_start_balance: accountSize,
        highest_equity: accountSize,
        max_daily_drawdown: maxDailyDrawdown,
        max_overall_drawdown: maxOverallDrawdown,
        profit_target: profitTarget,
        program_key: programKey || null,
        business_account_id: businessAccountId || null,
      })
      .select()
      .single();

    if (createError) {
      return NextResponse.json({ error: createError.message }, { status: 422 });
    }

    return NextResponse.json({ success: true, account: newAccount });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
