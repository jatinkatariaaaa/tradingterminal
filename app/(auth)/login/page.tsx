"use client"

import Link from "next/link"
import { useActionState } from "react"
import { signIn, type AuthActionState } from "../actions"

const initial: AuthActionState = { error: null }

export default function LoginPage() {
  const [state, action, pending] = useActionState(signIn, initial)

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6">
        <h1 className="text-lg font-semibold">Sign in</h1>
        <p className="mt-1 text-xs text-muted-foreground">Access your evaluation terminal.</p>
        <form action={action} className="mt-5 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium">
            Email
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
              className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </label>
          {state.error && <p className="text-xs text-[var(--loss)]">{state.error}</p>}
          <button
            type="submit"
            disabled={pending}
            className="mt-1 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {pending ? "Signing in\u2026" : "Sign in"}
          </button>
        </form>
        <p className="mt-4 text-xs text-muted-foreground">
          No account?{" "}
          <Link href="/signup" className="font-medium text-primary hover:underline">
            Create one
          </Link>
        </p>
      </div>
    </main>
  )
}
