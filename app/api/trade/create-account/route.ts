import { NextResponse } from "next/server"
import { requireUser } from "../_auth"
import { createSupabaseServiceClient } from "@/lib/supabase/service"

export async function POST(request: Request) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response

  const supabase = createSupabaseServiceClient()

  // 1. Check if user already has an account
  const { data: accounts, error: fetchError } = await supabase
    .from("accounts")
    .select("id")
    .eq("user_id", auth.userId)

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 422 })
  }

  // If user already has an account, return it
  if (accounts && accounts.length > 0) {
    return NextResponse.json({ message: "Account already exists", accounts })
  }

  // 2. Create a default $100,000 challenge account
  const defaultBalance = 100000
  const { data: newAccount, error: createError } = await supabase
    .from("accounts")
    .insert({
      user_id: auth.userId,
      label: "Apex Challenge",
      phase: "challenge",
      status: "active",
      starting_balance: defaultBalance,
      balance: defaultBalance,
      equity: defaultBalance,
      daily_start_balance: defaultBalance,
      highest_equity: defaultBalance,
      max_daily_drawdown: 0.05,
      max_overall_drawdown: 0.10,
      profit_target: 0.08,
    })
    .select()
    .single()

  if (createError) {
    return NextResponse.json({ error: createError.message }, { status: 422 })
  }

  return NextResponse.json({ account: newAccount })
}
