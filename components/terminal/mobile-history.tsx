"use client"

import { useMemo, useState } from "react"
import { Pencil, ShieldX, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { commissionFor, formatMoney, formatPrice, getAsset } from "@/lib/trading/assets"
import { useTrading } from "./trading-provider"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

type Tab = "positions" | "orders" | "deals"

function DirBadge({ direction }: { direction: "buy" | "sell" }) {
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
      style={{
        backgroundColor: direction === "buy" ? "var(--buy)" : "var(--sell)",
        color: direction === "buy" ? "var(--buy-foreground)" : "var(--sell-foreground)",
      }}
    >
      {direction}
    </span>
  )
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "profit" | "loss" | "accent" }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className={cn(
          "font-mono text-sm font-semibold tabular-nums",
          tone === "profit" && "text-[var(--profit)]",
          tone === "loss" && "text-[var(--loss)]",
          tone === "accent" && "text-primary",
        )}
      >
        {value}
      </span>
    </div>
  )
}

export function MobileHistory() {
  const {
    account,
    derived,
    openPositions,
    pendingOrders,
    closedTrades,
    prices,
    pnlFor,
    closePosition,
    closeAllPositions,
    cancelPending,
    beginManage,
  } = useTrading()
  const [tab, setTab] = useState<Tab>("positions")

  // MT5-style account ledger.
  const profit = account.balance - account.startingBalance
  const commission = useMemo(
    () => -closedTrades.reduce((sum, t) => sum + commissionFor(t.volume), 0),
    [closedTrades],
  )
  const now = new Date()
  const stamp = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, "0")}.${String(
    now.getDate(),
  ).padStart(2, "0")} ${now.toLocaleTimeString("en-GB")}`

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "positions", label: "Positions", count: openPositions.length },
    { key: "orders", label: "Orders", count: pendingOrders.length },
    { key: "deals", label: "Deals", count: closedTrades.length },
  ]

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* Header + balance ledger (MT5-style) */}
      <header className="border-b border-border bg-card px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-3">
        <div className="flex items-baseline justify-between">
          <h1 className="text-base font-bold">Balance</h1>
          <span className="font-mono text-2xl font-bold tabular-nums text-primary">
            {formatMoney(derived.equity).replace("$", "")}
          </span>
        </div>
        <p className="text-right text-[11px] text-muted-foreground">{stamp}</p>
        <div className="mt-2 border-t border-border pt-1">
          <Row label="Deposit" value={formatMoney(account.startingBalance)} />
          <Row label="Profit" value={`${profit >= 0 ? "+" : ""}${formatMoney(profit)}`} tone={profit >= 0 ? "profit" : "loss"} />
          <Row label="Floating P&L" value={`${derived.floatingPnl >= 0 ? "+" : ""}${formatMoney(derived.floatingPnl)}`} tone={derived.floatingPnl >= 0 ? "profit" : "loss"} />
          <Row label="Swap" value={formatMoney(0)} />
          <Row label="Commission" value={formatMoney(commission)} tone={commission < 0 ? "loss" : undefined} />
          <div className="border-t border-border">
            <Row label="Balance" value={formatMoney(account.balance)} />
          </div>
        </div>
      </header>

      {/* Segmented control */}
      <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-2">
        <div className="flex flex-1 items-center gap-1 rounded-lg bg-secondary p-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1 rounded-md py-1.5 text-xs font-semibold transition-colors",
                tab === t.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
              )}
            >
              {t.label}
              <span className="text-[10px] opacity-60">{t.count}</span>
            </button>
          ))}
        </div>
        {tab === "positions" && openPositions.length > 0 && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                size="icon"
                className="h-9 w-9 shrink-0 bg-[var(--loss)] text-background hover:bg-[var(--loss)]/90"
                aria-label="Close all positions"
              >
                <ShieldX className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Close all open positions?</AlertDialogTitle>
                <AlertDialogDescription>
                  This instantly liquidates all {openPositions.length} open position
                  {openPositions.length === 1 ? "" : "s"} at the current market price. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={closeAllPositions}
                  className="bg-[var(--loss)] text-background hover:bg-[var(--loss)]/90"
                >
                  Close All
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {/* List */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "positions" &&
          (openPositions.length === 0 ? (
            <Empty>No open positions. Place an order from the Chart tab.</Empty>
          ) : (
            <ul className="divide-y divide-border">
              {openPositions.map((p) => {
                const asset = getAsset(p.symbol)
                const price = prices[p.symbol] ?? p.entryPrice
                const pnl = pnlFor(p, price)
                return (
                  <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <DirBadge direction={p.direction} />
                        <span className="text-sm font-bold">{p.symbol}</span>
                        <span className="font-mono text-xs text-muted-foreground">{p.volume} lots</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                        <span>
                          Entry <span className="font-mono text-foreground/80">{formatPrice(p.entryPrice, asset.digits)}</span>
                        </span>
                        <span>
                          Now <span className="font-mono text-foreground/80">{formatPrice(price, asset.digits)}</span>
                        </span>
                        <span>SL {p.stopLoss != null ? formatPrice(p.stopLoss, asset.digits) : "—"}</span>
                        <span>TP {p.takeProfit != null ? formatPrice(p.takeProfit, asset.digits) : "—"}</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span
                        className="font-mono text-sm font-bold tabular-nums"
                        style={{ color: pnl >= 0 ? "var(--profit)" : "var(--loss)" }}
                      >
                        {pnl >= 0 ? "+" : ""}
                        {formatMoney(pnl)}
                      </span>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="secondary"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => beginManage(p.id)}
                          aria-label="Manage position"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="icon"
                          className="h-7 w-7 text-[var(--loss)]"
                          onClick={() => closePosition(p.id)}
                          aria-label="Close position"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          ))}

        {tab === "orders" &&
          (pendingOrders.length === 0 ? (
            <Empty>No pending limit / stop orders.</Empty>
          ) : (
            <ul className="divide-y divide-border">
              {pendingOrders.map((o) => {
                const asset = getAsset(o.symbol)
                return (
                  <li key={o.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <DirBadge direction={o.direction} />
                        <span className="text-sm font-bold">{o.symbol}</span>
                        <span className="text-[10px] font-semibold uppercase text-muted-foreground">{o.type}</span>
                        <span className="font-mono text-xs text-muted-foreground">{o.volume} lots</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                        <span>
                          Trigger <span className="font-mono text-foreground/80">{formatPrice(o.triggerPrice, asset.digits)}</span>
                        </span>
                        <span>SL {o.stopLoss != null ? formatPrice(o.stopLoss, asset.digits) : "—"}</span>
                        <span>TP {o.takeProfit != null ? formatPrice(o.takeProfit, asset.digits) : "—"}</span>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon"
                      className="h-7 w-7 text-[var(--loss)]"
                      onClick={() => cancelPending(o.id)}
                      aria-label="Cancel order"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                )
              })}
            </ul>
          ))}

        {tab === "deals" &&
          (closedTrades.length === 0 ? (
            <Empty>No closed trades yet.</Empty>
          ) : (
            <ul className="divide-y divide-border">
              {closedTrades.map((t) => {
                const asset = getAsset(t.symbol)
                const closed = new Date(t.closedAt)
                return (
                  <li key={`${t.id}-${t.closedAt}`} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <DirBadge direction={t.direction} />
                        <span className="text-sm font-bold">{t.symbol}</span>
                        <span className="font-mono text-xs text-muted-foreground">{t.volume} lots</span>
                        <span className="text-[10px] font-semibold uppercase text-muted-foreground">{t.reason}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                        <span>
                          {formatPrice(t.entryPrice, asset.digits)} → {formatPrice(t.exitPrice, asset.digits)}
                        </span>
                        <span>{closed.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}</span>
                      </div>
                    </div>
                    <span
                      className="font-mono text-sm font-bold tabular-nums"
                      style={{ color: t.realizedPnl >= 0 ? "var(--profit)" : "var(--loss)" }}
                    >
                      {t.realizedPnl >= 0 ? "+" : ""}
                      {formatMoney(t.realizedPnl)}
                    </span>
                  </li>
                )
              })}
            </ul>
          ))}
      </div>
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 py-16 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}
