"use client"

import { useState } from "react"
import { Pencil, X, ShieldX } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatMoney, formatPrice, getAsset } from "@/lib/trading/assets"
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
import { MobileAccountDetails } from "./account-bar"

type Tab = "open" | "pending" | "history" | "account"

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

export function PositionsPanel() {
  const {
    openPositions,
    pendingOrders,
    closedTrades,
    prices,
    pnlFor,
    closePosition,
    closeAllPositions,
    cancelPending,
    beginManage,
    managePositionId,
    selectedPositionId,
    setSelectedPositionId,
  } = useTrading()
  const [tab, setTab] = useState<Tab>("open")

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "open", label: "Positions", count: openPositions.length },
    { key: "pending", label: "Pending", count: pendingOrders.length },
    { key: "history", label: "History", count: closedTrades.length },
    { key: "account", label: "Account Details" },
  ]

  return (
    <section className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "rounded px-2.5 py-1 text-xs font-medium transition-colors",
              tab === t.key
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            {t.count !== undefined && <span className="ml-1 text-[10px] text-muted-foreground">{t.count}</span>}
          </button>
        ))}

        {/* Panic button — liquidate everything at market. */}
        {openPositions.length > 0 && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                size="sm"
                className="ml-auto h-7 gap-1.5 bg-[var(--loss)] px-2.5 text-xs font-semibold text-background hover:bg-[var(--loss)]/90"
              >
                <ShieldX className="h-3.5 w-3.5" />
                Close All
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Close all open positions?</AlertDialogTitle>
                <AlertDialogDescription>
                  This instantly liquidates all {openPositions.length} open position
                  {openPositions.length === 1 ? "" : "s"} at the current market price. This cannot
                  be undone.
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

      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "open" && (
          <Table
            head={["Symbol", "Dir", "Vol", "Entry", "Price", "SL", "TP", "Floating P&L", "Manage"]}
            empty="No open positions. Place an order to get started."
            rows={openPositions.map((p) => {
              const asset = getAsset(p.symbol)
              const price = prices[p.symbol] ?? p.entryPrice
              const pnl = pnlFor(p, price)
              const isManaging = managePositionId === p.id
              const isSelected = selectedPositionId === p.id
              return (
                <tr
                  key={p.id}
                  onClick={() => setSelectedPositionId(isSelected ? null : p.id)}
                  className={cn(
                    "border-b border-border/50 hover:bg-accent/40 cursor-pointer transition-colors",
                    isSelected && !isManaging && "bg-primary/5",
                    isManaging && "bg-primary/10 hover:bg-primary/15",
                  )}
                >
                  <Td className="font-medium">{p.symbol}</Td>
                  <Td>
                    <DirBadge direction={p.direction} />
                  </Td>
                  <Td className="font-mono tabular-nums">{p.volume}</Td>
                  <Td className="font-mono tabular-nums">{formatPrice(p.entryPrice, asset.digits)}</Td>
                  <Td className="font-mono tabular-nums">{formatPrice(price, asset.digits)}</Td>
                  <Td className="font-mono tabular-nums text-muted-foreground">
                    {p.stopLoss != null ? formatPrice(p.stopLoss, asset.digits) : "—"}
                  </Td>
                  <Td className="font-mono tabular-nums text-muted-foreground">
                    {p.takeProfit != null ? formatPrice(p.takeProfit, asset.digits) : "—"}
                  </Td>
                  <Td
                    className="font-mono font-semibold tabular-nums"
                    style={{ color: pnl >= 0 ? "var(--profit)" : "var(--loss)" }}
                  >
                    {pnl >= 0 ? "+" : ""}
                    {formatMoney(pnl)}
                  </Td>
                  <Td>
                    <div className="flex items-center justify-end gap-0.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className={cn(
                          "h-6 w-6 text-muted-foreground hover:text-foreground",
                          isManaging && "text-primary",
                        )}
                        onClick={(e) => {
                          e.stopPropagation()
                          beginManage(p.id)
                        }}
                        aria-label="Modify or partially close position"
                        title="Modify SL/TP · Partial close"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-[var(--loss)]"
                        onClick={(e) => {
                          e.stopPropagation()
                          closePosition(p.id)
                        }}
                        aria-label="Close position at market"
                        title="Close at market"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </Td>
                </tr>
              )
            })}
          />
        )}

        {tab === "pending" && (
          <Table
            head={["Symbol", "Type", "Dir", "Vol", "Trigger", "SL", "TP", ""]}
            empty="No pending limit / stop orders."
            rows={pendingOrders.map((o) => {
              const asset = getAsset(o.symbol)
              return (
                <tr key={o.id} className="border-b border-border/50 hover:bg-accent/40">
                  <Td className="font-medium">{o.symbol}</Td>
                  <Td className="uppercase text-muted-foreground">{o.type}</Td>
                  <Td>
                    <DirBadge direction={o.direction} />
                  </Td>
                  <Td className="font-mono tabular-nums">{o.volume}</Td>
                  <Td className="font-mono tabular-nums">{formatPrice(o.triggerPrice, asset.digits)}</Td>
                  <Td className="font-mono tabular-nums text-muted-foreground">
                    {o.stopLoss != null ? formatPrice(o.stopLoss, asset.digits) : "—"}
                  </Td>
                  <Td className="font-mono tabular-nums text-muted-foreground">
                    {o.takeProfit != null ? formatPrice(o.takeProfit, asset.digits) : "—"}
                  </Td>
                  <Td>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-[var(--loss)]"
                      onClick={() => cancelPending(o.id)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </Td>
                </tr>
              )
            })}
          />
        )}

        {tab === "history" && (
          <Table
            head={["Symbol", "Dir", "Vol", "Entry", "Exit", "Reason", "Realized P&L"]}
            empty="No closed trades yet."
            rows={closedTrades.map((t) => {
              const asset = getAsset(t.symbol)
              return (
                <tr key={`${t.id}-${t.closedAt}`} className="border-b border-border/50 hover:bg-accent/40">
                  <Td className="font-medium">{t.symbol}</Td>
                  <Td>
                    <DirBadge direction={t.direction} />
                  </Td>
                  <Td className="font-mono tabular-nums">{t.volume}</Td>
                  <Td className="font-mono tabular-nums">{formatPrice(t.entryPrice, asset.digits)}</Td>
                  <Td className="font-mono tabular-nums">{formatPrice(t.exitPrice, asset.digits)}</Td>
                  <Td className="uppercase text-muted-foreground">{t.reason}</Td>
                  <Td
                    className="font-mono font-semibold tabular-nums"
                    style={{ color: t.realizedPnl >= 0 ? "var(--profit)" : "var(--loss)" }}
                  >
                    {t.realizedPnl >= 0 ? "+" : ""}
                    {formatMoney(t.realizedPnl)}
                  </Td>
                </tr>
              )
            })}
          />
        )}

        {tab === "account" && (
          <div className="h-full overflow-auto bg-background p-2">
            <MobileAccountDetails />
          </div>
        )}
      </div>
    </section>
  )
}

function Table({
  head,
  rows,
  empty,
}: {
  head: string[]
  rows: React.ReactNode[]
  empty: string
}) {
  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
        {empty}
      </div>
    )
  }
  return (
    <table className="w-full border-collapse text-xs">
      <thead className="sticky top-0 bg-background">
        <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
          {head.map((h, i) => (
            <th key={i} className="px-3 py-2 font-medium">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{rows}</tbody>
    </table>
  )
}

function Td({
  children,
  className,
  style,
}: {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <td className={cn("px-3 py-2", className)} style={style}>
      {children}
    </td>
  )
}
