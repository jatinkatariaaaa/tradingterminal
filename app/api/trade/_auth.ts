import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase/server"

/**
 * Resolve the authenticated user for a trade route. Returns the user id or a
 * 401 response. Every /api/trade/* handler calls this first; the SQL functions
 * additionally re-verify account ownership (defence in depth).
 */
export async function requireUser(): Promise<
  { ok: true; userId: string } | { ok: false; response: NextResponse }
> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }
  return { ok: true, userId: user.id }
}
