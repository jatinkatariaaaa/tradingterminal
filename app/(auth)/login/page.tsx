"use client"

import { useActionState } from "react"
import { AlertCircle, ArrowUpRight } from "lucide-react"
import { signIn, type AuthActionState } from "../actions"
import { AuthShell, AuthField } from "@/components/auth/auth-shell"
import { SITE_URL } from "@/components/terminal/brand"

const initial: AuthActionState = { error: null }

export default function LoginPage() {
  const [state, action, pending] = useActionState(signIn, initial)

  return (
    <AuthShell>
      <div className="w-full max-w-[380px]">
        <h1 className="text-[28px] leading-tight font-bold tracking-[-0.03em]">Sign in</h1>
        <p className="mt-2 text-[14.5px] leading-relaxed text-muted-foreground">Use the same email and password as your dashboard.</p>

        <form action={action} className="mt-8 flex flex-col gap-4">
          <AuthField label="Email" name="email" type="email" autoComplete="email" inputMode="email" placeholder="you@example.com" required />
          <AuthField label="Password" name="password" type="password" autoComplete="current-password" placeholder="Your password" required />

          {state.error ? (
            <div role="alert" className="flex items-start gap-2 rounded-xl border border-loss/30 bg-loss/10 px-3.5 py-3 text-[13px] font-medium text-loss">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{state.error}</span>
            </div>
          ) : null}

          <button type="submit" disabled={pending} className="mt-1 h-12 rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60">
            {pending ? "Signing in\u2026" : "Sign in"}
          </button>
          <a href={`${SITE_URL}/login`} className="text-center text-[13px] font-medium text-muted-foreground hover:text-foreground">
            Forgot your password?
          </a>
        </form>

        <div className="mt-8 rounded-2xl border border-border bg-card p-4">
          <p className="text-[13.5px] font-semibold">New to The People Prop?</p>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">Create your login on the website, pick an account type, and it appears here once it is issued.</p>
          <a href={`${SITE_URL}/login?mode=signup`} className="mt-3 inline-flex items-center gap-1 text-[13.5px] font-semibold text-foreground underline decoration-volt decoration-2 underline-offset-4">
            Create an account <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </AuthShell>
  )
}
