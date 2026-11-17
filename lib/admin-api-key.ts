import { timingSafeEqual } from "crypto"
import { createSupabaseServiceClient } from "@/lib/supabase/service"

/**
 * Authenticates calls from The People Prop's CRM to /api/admin/*.
 *
 * The key lives in the database (tpp_platforms, the "TPP TERMINAL" row), where
 * the admin panel manages it, and both apps read it from there. ADMIN_API_KEY
 * can also be set in this app's environment. Nothing secret is written in code.
 */

const same = (a: string, b: string) => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export async function verifyAdminApiKey(request: Request): Promise<boolean> {
  const provided = (request.headers.get("x-api-key") || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "").trim()
  if (provided.length < 8) return false

  const fromEnv = process.env.ADMIN_API_KEY
  if (fromEnv && same(provided, fromEnv)) return true

  try {
    const supabase = createSupabaseServiceClient()
    const { data } = await supabase.from("tpp_platforms").select("api_key").eq("name", "TPP TERMINAL").eq("is_active", true).maybeSingle()
    return Boolean(data?.api_key) && same(provided, String(data!.api_key))
  } catch {
    return false
  }
}
