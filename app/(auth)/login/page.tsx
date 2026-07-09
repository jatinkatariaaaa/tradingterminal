"use client"

import Link from "next/link"
import { useActionState } from "react"
import { AlertCircle } from "lucide-react"
import { signIn, type AuthActionState } from "../actions"
import { AuthShell, AuthField } from "@/components/auth/auth-shell"

const initial: AuthActionState = { error: null }

export default function LoginPage() {
  const [state, action, pending] = useActionState(signIn, initial)

  return (
    <AuthShell>
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Sign in to access your evaluation terminal.
        </p>

        <form action={action} className="mt-8 flex flex-col gap-4">
          <AuthField
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            required
          />
          <AuthField
            label="Password"
            name="password"
            type="password"
            autoComplete="current-password"
            placeholder="Your password"
            required
          />

          {state.error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-[var(--loss)]/30 bg-[var(--loss)]/10 px-3 py-2.5 text-xs font-medium text-[var(--loss)]"
            >
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{state.error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={pending}
            className="mt-1 h-11 rounded-lg bg-primary text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {pending ? "Signing in\u2026" : "Sign in"}
          </button>
        </form>

        <div className="mt-6 flex items-center gap-3">
          <span className="h-px flex-1 bg-border" />
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
            New here?
          </span>
          <span className="h-px flex-1 bg-border" />
        </div>

        <Link
          href="/signup"
          className="mt-4 flex h-11 items-center justify-center rounded-lg border border-border text-sm font-medium transition-colors hover:bg-secondary"
        >
          Create an account
        </Link>
      </div>
    </AuthShell>
  )
}
