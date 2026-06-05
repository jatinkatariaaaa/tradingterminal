// Server-authoritative account model (Phase 3). Mirrors the `accounts` row in
// Supabase. These values are the source of truth for evaluation pass/fail and
// are written ONLY by trusted server code; the client treats them as read-only.
//
// This extends the legacy client-side AccountState (lib/trading/types.ts) with
// the prop-firm phase lifecycle and richer status transitions. The two will be
// reconciled as the risk math moves server-side in later steps.

/** Evaluation lifecycle: a user buys a Challenge, which can be promoted to Funded. */
export type AccountPhase = "challenge" | "funded"

/**
 * Account status transitions:
 *  - active:   trading allowed (the normal state for challenge or funded).
 *  - passed:   profit target hit on a challenge; awaiting promotion to funded.
 *  - breached: a drawdown limit was hit; account is frozen (terminal).
 *  - funded:   promoted live-funded account (kept distinct so the UI can badge it).
 */
export type ServerAccountStatus = "active" | "passed" | "breached" | "funded"

/** A single evaluation account. A user may own many (multiple challenges). */
export interface ServerAccount {
  id: string
  userId: string
  /** Human label, e.g. "50K Challenge #2". */
  label: string
  phase: AccountPhase
  status: ServerAccountStatus
  /** The fixed balance the account was created with (drawdown anchor). */
  startingBalance: number
  /** Realized balance — server-authoritative. */
  balance: number
  /** Mark-to-market equity — recomputed server-side on each price tick. */
  equity: number
  /** Balance the current trading day opened with (daily-drawdown basis). */
  dailyStartBalance: number
  /** Highest equity ever reached (for trailing/max-drawdown models). */
  highestEquity: number
  /** Drawdown limits as fractions of the relevant basis (e.g. 0.05 = 5%). */
  maxDailyDrawdown: number
  maxOverallDrawdown: number
  /** Profit target as a fraction of startingBalance (challenge pass condition). */
  profitTarget: number
  /** Why the account was breached, if applicable. */
  breachReason: string | null
  createdAt: string
  updatedAt: string
}
