import { AdminAuthError, requireRole } from "@/lib/admin-auth"
import { createSupabaseServiceClient } from "@/lib/supabase/service"
import { isReplayId, type ReplayCandle, type SavedReplay } from "./replay"

const REPLAY_COLUMNS = "id,symbol,timeframe,entry_time,direction,entry,stop_loss,target,lots,outcome,outcome_time,example_pnl,currency,notes"

interface ReplayRow {
  id: string
  symbol: string
  timeframe: number
  entry_time: number
  direction: SavedReplay["direction"]
  entry: number
  stop_loss: number
  target: number
  lots: number
  outcome: SavedReplay["outcome"]
  outcome_time: number | null
  example_pnl: number | null
  currency: string
  notes: string
}

function presentReplay(row: ReplayRow): SavedReplay {
  return {
    id: row.id,
    symbol: row.symbol,
    timeframe: row.timeframe,
    entryTime: row.entry_time,
    direction: row.direction,
    entry: row.entry,
    stopLoss: row.stop_loss,
    target: row.target,
    lots: row.lots,
    outcome: row.outcome,
    outcomeTime: row.outcome_time,
    examplePnl: row.example_pnl,
    currency: row.currency,
    notes: row.notes,
  }
}

export async function requireReplayAccount(accountId: string) {
  if (!isReplayId(accountId)) throw new AdminAuthError("Trading account not found", 404)
  const { user } = await requireRole(["super_admin"])
  const db = createSupabaseServiceClient()
  const { data: account, error } = await db
    .from("accounts")
    .select("id,label")
    .eq("id", accountId)
    .eq("user_id", user.id)
    .maybeSingle()
  if (error) throw error
  if (!account) throw new AdminAuthError("Trading account not found", 404)
  return { db, account, userId: user.id }
}

export async function listReplays(accountId: string, access: Awaited<ReturnType<typeof requireReplayAccount>>) {
  const { data, error } = await access.db
    .from("trade_replays")
    .select(REPLAY_COLUMNS)
    .eq("account_id", accountId)
    .eq("created_by", access.userId)
    .order("created_at", { ascending: false })
    .limit(100)
  if (error) throw error
  return data.map(presentReplay)
}

export async function getSharedReplay(id: string) {
  if (!isReplayId(id)) return null
  const db = createSupabaseServiceClient()
  const { data, error } = await db
    .from("trade_replays")
    .select("id,symbol,timeframe,entry_time,direction,entry,stop_loss,target,lots,outcome,outcome_time,example_pnl,currency,notes,candles")
    .eq("id", id)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return { replay: presentReplay(data), candles: data.candles as ReplayCandle[] }
}
