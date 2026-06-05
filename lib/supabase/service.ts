import { createClient, type SupabaseClient } from "@supabase/supabase-js"

/**
 * Privileged service-role Supabase client for use ONLY inside trusted Next.js
 * route handlers (never a Client Component). Bypasses RLS, so it must only be
 * used after the route has authenticated the user and verified ownership.
 */
export function createSupabaseServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
