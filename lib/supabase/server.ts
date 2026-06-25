import { cookies } from "next/headers"
import { createServerClient } from "@supabase/ssr"

/**
 * Supabase client for Server Components, Route Handlers and Server Actions.
 *
 * Reads the user's session from cookies so server-side queries run AS the
 * signed-in user (RLS still applies). Use this for authenticated reads on the
 * server. For privileged, server-authoritative WRITES (opening positions,
 * recomputing equity, firing breaches) use createSupabaseServiceClient()
 * instead, which bypasses RLS with the service-role key.
 */
export async function createSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. See .env.example.",
    )
  }
  const cookieStore = await cookies()
  const cookieDomain = process.env.NEXT_PUBLIC_COOKIE_DOMAIN;
  const cookieOptions = cookieDomain ? { domain: cookieDomain } : undefined;
  
  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet: any[]) => {
        try {
          for (const { name, value, options } of toSet) {
            cookieStore.set(name, value, cookieDomain ? { ...options, domain: cookieDomain } : options)
          }
        } catch {
          // setAll can be called from a Server Component where cookies are
          // read-only; the middleware/route handler refresh path covers it.
        }
      },
    },
    cookieOptions,
  })
}

/**
 * PRIVILEGED server-only client using the service-role key. Bypasses RLS, so it
 * must only ever be created in trusted server contexts (route handlers, the
 * Node risk worker) and never imported into a Client Component. This is the
 * client that later steps use to write the authoritative money/status columns.
 */
export function createSupabaseServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. See .env.example.",
    )
  }
  // Lazy import keeps the service client out of any accidental client bundle.
  const { createClient } = require("@supabase/supabase-js") as typeof import("@supabase/supabase-js")
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
