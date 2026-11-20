import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { createSupabaseServiceClient } from "@/lib/supabase/service"
import { getAsset } from "@/lib/trading/assets"

/**
 * Admin-only API to record a past / demo trade for an account.
 * Inserts directly into public.trades with is_demo = true.
 * Realtime subscribers will instantly reflect the new trade in history.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const service = createSupabaseServiceClient()

    // Verify admin privileges
    const [{ data: profile }, { data: role }] = await Promise.all([
      service.from("profiles").select("is_admin").eq("id", user.id).maybeSingle(),
      service.from("admin_roles").select("role").eq("user_id", user.id).maybeSingle(),
    ])

    const isAdmin = Boolean(profile?.is_admin || role?.role)
    if (!isAdmin) {
      return NextResponse.json({ error: "Forbidden: Admin privileges required" }, { status: 403 })
    }

    const body = await request.json()
    const {
      accountId,
      symbol,
      direction,
      volume,
      openPrice,
      closePrice,
      openTime,
      closeTime,
      stopLoss,
      takeProfit,
      reason = "manual",
      grossPnl: manualGrossPnl,
    } = body

    if (
      !accountId ||
      !symbol ||
      !direction ||
      !volume ||
      !openPrice ||
      !closePrice ||
      !openTime ||
      !closeTime
    ) {
      return NextResponse.json(
        { error: "Missing required trade fields: accountId, symbol, direction, volume, prices and times are required." },
        { status: 400 }
      )
    }

    // Verify account exists
    const { data: account, error: accError } = await service
      .from("accounts")
      .select("id, user_id, balance, starting_balance")
      .eq("id", accountId)
      .maybeSingle()

    if (accError || !account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 })
    }

    const asset = getAsset(symbol)
    const sign = direction === "buy" ? 1 : -1

    // Calculate gross profit if not manually provided
    let grossPnl = manualGrossPnl
    if (grossPnl === undefined || grossPnl === null) {
      const priceDiff = (Number(closePrice) - Number(openPrice)) * sign
      grossPnl = priceDiff * Number(volume) * asset.contractSize
    }

    const commission = Number((Number(volume) * 6).toFixed(2)) // standard $6/lot round-turn
    const swap = 0
    const netPnl = Number((Number(grossPnl) - commission).toFixed(2))

    // Insert trade row with is_demo = true
    const { data: trade, error: insertError } = await service
      .from("trades")
      .insert({
        account_id: accountId,
        symbol,
        direction,
        volume: Number(volume),
        open_price: Number(openPrice),
        close_price: Number(closePrice),
        open_time: new Date(openTime).toISOString(),
        close_time: new Date(closeTime).toISOString(),
        gross_pnl: Number(grossPnl),
        commission,
        swap,
        net_pnl: netPnl,
        reason: reason as "tp" | "sl" | "manual" | "breach",
        stop_loss: stopLoss != null && stopLoss !== "" ? Number(stopLoss) : null,
        take_profit: takeProfit != null && takeProfit !== "" ? Number(takeProfit) : null,
        is_demo: true,
      })
      .select()
      .single()

    if (insertError) {
      console.error("[create-record] Insert trade failed:", insertError)
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, trade })
  } catch (err: any) {
    console.error("[create-record] Exception:", err)
    return NextResponse.json({ error: err.message || "Internal error" }, { status: 500 })
  }
}
