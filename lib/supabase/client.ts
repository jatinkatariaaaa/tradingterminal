import { createBrowserClient } from "@supabase/ssr"

/**
 * Supabase client for use in Client Components ("use client").
 *
 * Uses the public anon key, so every query is constrained by Row-Level
 * Security: a signed-in user can only ever read their own profile and accounts.
 * This client is safe to ship to the browser; it can never mutate money or
 * status columns because those are denied to the anon/authenticated role by RLS
 * (all such writes go through trusted server code in later steps).
 */
export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. See .env.example.",
    )
  }
  return createBrowserClient(url, anonKey)
}
