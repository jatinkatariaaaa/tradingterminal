import { NextResponse } from "next/server"
import { getHistoricalCandles } from "@/lib/trading/historical-candles"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const symbol = (url.searchParams.get("symbol") ?? "").trim().toUpperCase()
  const timeframe = Number(url.searchParams.get("tf") ?? "60")
  return NextResponse.json({ candles: await getHistoricalCandles(symbol, timeframe) })
}
