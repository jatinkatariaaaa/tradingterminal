import { NextResponse } from "next/server"
import { z } from "zod"
import { AdminAuthError } from "@/lib/admin-auth"
import { getHistoricalCandles } from "@/lib/trading/historical-candles"
import { completedCandles, evaluateReplay, isReplayId, REPLAY_ASSETS, REPLAY_TIMEFRAMES } from "@/lib/trading/replay"
import { requireReplayAccount } from "@/lib/trading/replay-store"

const price = z.number().positive().max(1e8)
const input = z.object({
  id: z.string().refine(isReplayId),
  accountId: z.string().refine(isReplayId),
  symbol: z.string().refine((symbol) => REPLAY_ASSETS.some((asset) => asset.symbol === symbol)),
  timeframe: z.number().refine((timeframe) => REPLAY_TIMEFRAMES.some((tf) => tf.seconds === timeframe)),
  entryTime: z.number().int().positive(),
  direction: z.enum(["buy", "sell"]),
  entry: price,
  stopLoss: price,
  target: price,
  lots: z.number().min(0.01).max(100),
  notes: z.string().trim().max(500),
})

function failure(error: unknown) {
  if (error instanceof AdminAuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  console.error("Trade Replay request failed", error)
  return NextResponse.json({ error: "Trade Replay is temporarily unavailable." }, { status: 500 })
}

export async function GET(request: Request) {
  try {
    await requireReplayAccount(new URL(request.url).searchParams.get("accountId") || "")
    return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return failure(error)
  }
}

export async function POST(request: Request) {
  try {
    if (!request.headers.get("content-type")?.startsWith("application/json")) {
      return NextResponse.json({ error: "Send a JSON request." }, { status: 415 })
    }
    const parsed = input.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: "Enter a valid trade setup." }, { status: 400 })
    const { id, accountId, notes, ...setup } = parsed.data
    const { db, userId } = await requireReplayAccount(accountId)
    const findSaved = () => db.from("trade_replays").select("id")
      .eq("id", id).eq("account_id", accountId).eq("created_by", userId).maybeSingle()
    const previous = await findSaved()
    if (previous.error) throw previous.error
    if (previous.data) return NextResponse.json({ id: previous.data.id })

    const candles = completedCandles(await getHistoricalCandles(setup.symbol, setup.timeframe), setup.timeframe)
    if (!candles.length) {
      return NextResponse.json({ error: "Historical candles are unavailable for this instrument and timeframe." }, { status: 503 })
    }
    let result
    try {
      result = evaluateReplay(setup, candles)
    } catch (error) {
      return NextResponse.json({ error: (error as Error).message }, { status: 400 })
    }

    const first = Math.max(0, candles.findIndex((bar) => bar.time === setup.entryTime) - 80)
    const last = result.outcomeTime === null
      ? candles.length
      : candles.findIndex((bar) => bar.time === result.outcomeTime) + 26
    const { error } = await db.from("trade_replays").insert({
      id,
      account_id: accountId,
      created_by: userId,
      symbol: setup.symbol,
      timeframe: setup.timeframe,
      entry_time: setup.entryTime,
      direction: setup.direction,
      entry: setup.entry,
      stop_loss: setup.stopLoss,
      target: setup.target,
      lots: setup.lots,
      notes,
      outcome: result.outcome,
      outcome_time: result.outcomeTime,
      example_pnl: result.examplePnl,
      currency: result.currency,
      candles: candles.slice(first, last),
    })
    if (error?.code === "23505") {
      const saved = await findSaved()
      if (saved.data) return NextResponse.json({ id: saved.data.id })
    }
    if (error) throw error
    return NextResponse.json({ id }, { status: 201 })
  } catch (error) {
    return failure(error)
  }
}
