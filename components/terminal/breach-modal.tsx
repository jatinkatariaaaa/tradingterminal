"use client"

import { ShieldX } from "lucide-react"
import { formatMoney } from "@/lib/trading/assets"
import { useTrading } from "./trading-provider"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export function BreachModal() {
  const { account, resetAccount } = useTrading()
  const open = account.status === "breached"

  return (
    <Dialog open={open}>
      <DialogContent
        showCloseButton={false}
        className="border-[var(--loss)]/40 sm:max-w-md"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="items-center text-center">
          <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--loss)]/15">
            <ShieldX className="h-7 w-7 text-[var(--loss)]" />
          </div>
          <DialogTitle className="text-xl">Account Breached</DialogTitle>
          <DialogDescription className="text-pretty">
            Evaluation failed. A hard drawdown limit was hit, so all positions were force-closed and
            the terminal is frozen.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 rounded-md bg-secondary/60 p-4 text-sm">
          <p className="text-pretty leading-relaxed text-muted-foreground">
            {account.breachReason}
          </p>
          <div className="flex items-center justify-between border-t border-border pt-3">
            <span className="text-muted-foreground">Final Balance</span>
            <span
              className="font-mono font-semibold tabular-nums"
              style={{ color: account.balance >= account.startingBalance ? "var(--profit)" : "var(--loss)" }}
            >
              {formatMoney(account.balance)}
            </span>
          </div>
        </div>

      </DialogContent>
    </Dialog>
  )
}
