import type { ServerAccount } from "@/lib/trading/account"
import type { SupabaseClient } from "@supabase/supabase-js"

// Selected columns mapped from snake_case (DB) to the camelCase ServerAccount.
const ACCOUNT_COLUMNS =
  "id, user_id, label, phase, status, starting_balance, balance, equity, daily_start_balance, highest_equity, max_daily_drawdown, max_overall_drawdown, profit_target, breach_reason, created_at, updated_at"

interface AccountRow {
  id: string
  user_id: string
  label: string
  phase: ServerAccount["phase"]
  status: ServerAccount["status"]
  starting_balance: number
  balance: number
  equity: number
  daily_start_balance: number
  highest_equity: number
  max_daily_drawdown: number
  max_overall_drawdown: number
  profit_target: number
  breach_reason: string | null
  created_at: string
  updated_at: string
}

function mapAccount(row: AccountRow): ServerAccount {
  return {
    id: row.id,
    userId: row.user_id,
    label: row.label,
    phase: row.phase,
    status: row.status,
    startingBalance: Number(row.starting_balance),
    balance: Number(row.balance),
    equity: Number(row.equity),
    dailyStartBalance: Number(row.daily_start_balance),
    highestEquity: Number(row.highest_equity),
    maxDailyDrawdown: Number(row.max_daily_drawdown),
    maxOverallDrawdown: Number(row.max_overall_drawdown),
    profitTarget: Number(row.profit_target),
    breachReason: row.breach_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Read every account owned by the signed-in user. RLS guarantees only their own
 * rows come back regardless of what the client requests. Read-only in Step 1.
 */
export async function fetchMyAccounts(
  supabase: SupabaseClient,
): Promise<ServerAccount[]> {
  const { data, error } = await supabase
    .from("accounts")
    .select(ACCOUNT_COLUMNS)
    .order("created_at", { ascending: true })
  if (error) throw error
  return (data as AccountRow[]).map(mapAccount)
}

/** Read a single account by id (still RLS-scoped to the owner). */
export async function fetchAccountById(
  supabase: SupabaseClient,
  id: string,
): Promise<ServerAccount | null> {
  const { data, error } = await supabase
    .from("accounts")
    .select(ACCOUNT_COLUMNS)
    .eq("id", id)
    .maybeSingle()
  if (error) throw error
  return data ? mapAccount(data as AccountRow) : null
}
