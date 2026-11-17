import Link from "next/link"
import { ArrowUpRight } from "lucide-react"
import { AuthShell } from "@/components/auth/auth-shell"
import { SITE_URL } from "@/components/terminal/brand"

/** Logins are created on the website (terms, referral codes, verification), so this page hands over to it. */
export default function SignupPage() {
  return (
    <AuthShell>
      <div className="w-full max-w-[380px]">
        <h1 className="text-[28px] leading-tight font-bold tracking-[-0.03em]">Create your login</h1>
        <p className="mt-2 text-[14.5px] leading-relaxed text-muted-foreground">
          Logins are made on The People Prop website, where you accept the terms and choose your first account. The same email and password then work here.
        </p>
        <a href={`${SITE_URL}/login?mode=signup`} className="mt-8 flex h-12 items-center justify-center gap-1.5 rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground transition-opacity hover:opacity-90">
          Continue to {new URL(SITE_URL).host} <ArrowUpRight className="h-4 w-4" />
        </a>
        <Link href="/login" className="mt-3 flex h-12 items-center justify-center rounded-xl border border-border text-[14.5px] font-semibold transition-colors hover:bg-secondary">
          I already have a login
        </Link>
      </div>
    </AuthShell>
  )
}
