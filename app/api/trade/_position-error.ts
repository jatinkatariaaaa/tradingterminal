import { NextResponse } from "next/server"

export function positionError(message: string, positionId: string) {
  if (message === `position ${positionId} not found`) {
    return NextResponse.json(
      { code: "POSITION_NOT_OPEN", error: "This position is no longer open." },
      { status: 404 },
    )
  }
  return NextResponse.json({ error: message }, { status: 422 })
}
