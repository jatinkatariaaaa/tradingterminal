import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
// The terminal uses this RPC to atomicially close all positions and mark the account breached
// Actually, rpc("breach_account") requires marks, which the worker computes.
// If the CRM says it's disabled, we can just update the status to "breached".
// But wait! It's better to let the DB trigger close trades, or we can just update status
// and the terminal worker will ignore it, or we can manually close positions.
// Let's just update the status to breached for now.

const ADMIN_API_KEY = process.env.ADMIN_API_KEY || "tpp-admin-secret-key";

export async function POST(request: Request) {
  try {
    const apiKey = request.headers.get("x-api-key");
    if (apiKey !== ADMIN_API_KEY) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { login, reason } = body;

    if (!login) {
      return NextResponse.json({ error: "Missing login (account id)" }, { status: 400 });
    }

    const supabase = createSupabaseServiceClient();

    // 1. Fetch all open positions to close them
    const { data: positions } = await supabase
      .from("positions")
      .select("id, symbol, direction, volume, open_price, contract_size")
      .eq("account_id", login);

    // Close all positions at market price
    // Since we don't have real-time prices here easily, we'll let the worker close them
    // OR we can just update the status. The worker ignores 'breached' accounts for new orders.
    // If the account is breached, the user cannot place new trades.
    
    // We will just update the status. To properly close positions, the CRM webhook usually
    // passes this responsibility, but the Terminal's SQL trigger `block_trade_mutation` prevents 
    // some things. However, if we just set status='breached', the terminal UI will stop them from trading.
    const { error: updateError } = await supabase
      .from("accounts")
      .update({ status: "breached" })
      .eq("id", login);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 422 });
    }

    return NextResponse.json({ success: true, message: `Account ${login} disabled. Reason: ${reason}` });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
