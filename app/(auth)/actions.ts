"use server"

import { redirect } from "next/navigation"
import { createSupabaseServerClient } from "@/lib/supabase/server"

/** Result surfaced back to the auth forms on failure. */
export interface AuthActionState {
  error: string | null
}

function readCredentials(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim()
  const password = String(formData.get("password") ?? "")
  return { email, password }
}

export async function signIn(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const { email, password } = readCredentials(formData)
  if (!email || !password) return { error: "Email and password are required." }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return { error: error.message }
  redirect("/")
}

export async function signUp(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const { email, password } = readCredentials(formData)
  if (!email || !password) return { error: "Email and password are required." }
  if (password.length < 8) return { error: "Password must be at least 8 characters." }

  const supabase = await createSupabaseServerClient()
  // On sign-up the on_auth_user_created trigger (migration 0001) inserts the
  // matching public.profiles row automatically.
  const { error } = await supabase.auth.signUp({ email, password })
  if (error) return { error: error.message }
  redirect("/")
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient()
  await supabase.auth.signOut()
  redirect("/login")
}
