"use client"

import Link from "next/link"
import { useActionState } from "react"
import { AlertCircle } from "lucide-react"
import { signUp, type AuthActionState } from "../actions"
import { AuthShell, AuthField } from "@/components/auth/auth-shell"

const initial: AuthActionState = { error: null }

export default function SignupPage() {
  const [state, action, pending] = useActionState(signUp, initial)

  return (
    <AuthShell>
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Start your evaluation challenge in minutes.
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
            autoComplete="new-password"
            placeholder="At least 8 characters"
            minLength={8}
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
            {pending ? "Creating account\u2026" : "Create account"}
          </button>
        </form>

        <div className="mt-6 flex items-center gap-3">
          <span className="h-px flex-1 bg-border" />
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Already registered?
          </span>
          <span className="h-px flex-1 bg-border" />
        </div>

        <Link
          href="/login"
          className="mt-4 flex h-11 items-center justify-center rounded-lg border border-border text-sm font-medium transition-colors hover:bg-secondary"
        >
          Sign in instead
        </Link>
      </div>
    </AuthShell>
  )
}
