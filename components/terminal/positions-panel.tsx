"use client"

import { useMemo, useState, useEffect, type ReactNode } from "react"
import { Equal, History as HistoryIcon, Inbox, Layers, Pencil, Scissors, ShieldX, X, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatMoney, formatPrice, getAsset, roundToLotStep } from "@/lib/trading/assets"
import type { ClosedTrade } from "@/lib/trading/types"
import { useTrading } from "./trading-provider"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"
import { CreateTradeRecordModal } from "./create-trade-record-modal"
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
import { Objectives } from "./objectives"
import { DirChip, money, pnlTone } from "./kit"
import { duration, stamp } from "./mobile/ui"

type Tab = "open" | "pending" | "history" | "objectives"
type Period = "today" | "week" | "month" | "all"

const REASON: Record<ClosedTrade["reason"], string> = { tp: "Take profit", sl: "Stop loss", manual: "Manual", breach: "Rule breach" }
const DAY = 86_400_000

function since(p: Period) {
  if (p === "all") return 0
  if (p === "today") {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }
  return Date.now() - (p === "week" ? 7 : 30) * DAY
}

function Th({ children, right, className }: { children?: ReactNode; right?: boolean; className?: string }) {
  return <th className={cn("sticky top-0 z-[1] bg-card px-3 py-2 text-[10px] font-semibold tracking-[0.08em] whitespace-nowrap text-muted-foreground uppercase", right ? "text-right" : "text-left", className)}>{children}</th>
}

/* Columns that make way when the dock is narrow, so P/L and the actions never scroll off. */
const WIDE = "hidden @[980px]:table-cell"
const MID = "hidden @[860px]:table-cell"

function Td({ children, right, className, mono = true }: { children?: ReactNode; right?: boolean; className?: string; mono?: boolean }) {
  return <td className={cn("px-3 py-[7px] whitespace-nowrap", mono && "font-mono tabular-nums", right && "text-right", className)}>{children}</td>
}

function RowAction({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={cn("grid h-6 w-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background disabled:opacity-30", danger ? "hover:text-loss" : "hover:text-foreground")}
    >
      {children}
    </button>
  )
}

function Empty({ icon: Icon, title, text }: { icon: typeof Inbox; title: string; text: string }) {
  return (
    <div className="flex h-full min-h-[120px] flex-col items-center justify-center gap-1 p-6 text-center">
      <Icon className="mb-1 h-5 w-5 text-muted-foreground" />
      <p className="text-[13px] font-semibold">{title}</p>
      <p className="max-w-[320px] text-[12px] text-muted-foreground">{text}</p>
    </div>
  )
}

/** The trade dock under the chart: open positions, pending orders, history and objectives. */
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
    setActiveSymbol,
    modifyPosition,
    partialClose,
    account,
    accountId,
  } = useTrading()
  const [tab, setTab] = useState<Tab>("open")
  const [period, setPeriod] = useState<Period>("all")
  const [isAdmin, setIsAdmin] = useState(false)
  const [showRecordModal, setShowRecordModal] = useState(false)

  useEffect(() => {
    try {
      const supabase = createSupabaseBrowserClient()
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (!user) return
        Promise.all([
          supabase.from("profiles").select("is_admin").eq("id", user.id).maybeSingle(),
          supabase.from("admin_roles").select("role").eq("user_id", user.id).maybeSingle(),
        ]).then(([{ data: p }, { data: r }]) => {
          if (p?.is_admin || r?.role) setIsAdmin(true)
        }).catch(() => {})
      }).catch(() => {})
    } catch {}
  }, [])

  const totalPnl = openPositions.reduce((sum, p) => sum + pnlFor(p, prices[p.symbol] ?? p.entryPrice), 0)

  const deals = useMemo(() => {
    const from = since(period)
    return closedTrades.filter((t) => t.closedAt >= from).sort((a, b) => b.closedAt - a.closedAt)
  }, [closedTrades, period])
  const net = deals.reduce((a, t) => a + t.realizedPnl, 0)
  const wins = deals.filter((t) => t.realizedPnl > 0).length

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "open", label: "Positions", count: openPositions.length },
    { key: "pending", label: "Orders", count: pendingOrders.length },
    { key: "history", label: "History", count: closedTrades.length },
    { key: "objectives", label: "Objectives" },
  ]

  return (
    <section className="@container flex h-full min-h-0 flex-col bg-card">
      <div className="flex h-10 shrink-0 items-stretch gap-1 border-b border-border px-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            aria-pressed={tab === t.key}
            className={cn("relative flex items-center gap-1.5 px-2.5 text-[12.5px] font-semibold transition-colors", tab === t.key ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {t.label}
            {t.count !== undefined ? (
              <span className={cn("min-w-[18px] rounded-full px-1.5 text-center text-[10.5px] leading-[17px] tabular-nums", tab === t.key ? "bg-foreground text-background" : "bg-secondary text-muted-foreground")}>{t.count}</span>
            ) : null}
            {tab === t.key ? <span className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-volt" /> : null}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-2">
          {tab === "open" && openPositions.length > 0 ? (
            <>
              <span className="text-[11px] text-muted-foreground">Floating</span>
              <span className={cn("font-mono text-[13px] font-semibold tabular-nums", pnlTone(totalPnl))}>{money(totalPnl, { sign: true })}</span>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button type="button" className="ml-1 flex h-7 items-center gap-1.5 rounded-lg border border-loss/40 px-2.5 text-[11.5px] font-semibold text-loss transition-colors hover:bg-loss hover:text-white">
                    <ShieldX className="h-3.5 w-3.5" /> Close all
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent className="rounded-2xl">
                  <AlertDialogHeader>
                    <AlertDialogTitle>Close all {openPositions.length} positions?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Every open position closes at the current market price, for a combined {money(totalPnl, { sign: true })}. Pending orders stay in place.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="rounded-xl">Keep them</AlertDialogCancel>
                    <AlertDialogAction onClick={closeAllPositions} className="rounded-xl bg-loss text-white hover:bg-loss/90">
                      Close all
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          ) : null}
          {tab === "history" ? (
            <>
              <span className="hidden items-center gap-3 text-[11.5px] text-muted-foreground lg:flex">
                <span>
                  {deals.length} trades · {deals.length ? Math.round((wins / deals.length) * 100) : 0}% won
                </span>
                <span className={cn("font-mono font-semibold tabular-nums", pnlTone(net))}>{money(net, { sign: true })}</span>
              </span>
              <div className="flex rounded-lg bg-secondary p-0.5">
                {(["today", "week", "month", "all"] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPeriod(p)}
                    className={cn("h-6 rounded-md px-2 text-[11px] font-semibold capitalize transition-colors", period === p ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
                  >
                    {p}
                  </button>
                ))}
              </div>
              {isAdmin && accountId && (
                <button
                  type="button"
                  onClick={() => setShowRecordModal(true)}
                  className="flex h-6 items-center gap-1.5 rounded-md bg-volt px-2.5 text-[11px] font-bold text-volt-foreground shadow-sm transition-all hover:opacity-90 active:scale-95 cursor-pointer ml-1"
                  title="Create historical demo trade"
                >
                  <Sparkles className="h-3 w-3" />
                  <span>Create Trades Records</span>
                </button>
              )}
            </>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
        {tab === "open" ? (
          openPositions.length === 0 ? (
            <Empty icon={Layers} title="No open positions" text={account.tradable ? "Use the order ticket, the one-click buttons over the chart, or a price in the market watch." : "This account can't open new trades."} />
          ) : (
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-border">
                  <Th>Symbol</Th>
                  <Th>Side</Th>
                  <Th right>Volume</Th>
                  <Th className={WIDE}>Opened</Th>
                  <Th right>Open price</Th>
                  <Th right>Current</Th>
                  <Th right>S/L</Th>
                  <Th right>T/P</Th>
                  <Th right className={MID}>
                    Margin
                  </Th>
                  <Th right>P/L</Th>
                  <Th right>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {[...openPositions]
                  .sort((a, b) => b.openedAt - a.openedAt)
                  .map((p) => {
                    const asset = getAsset(p.symbol)
                    const price = prices[p.symbol] ?? p.entryPrice
                    const pnl = pnlFor(p, price)
                    const managing = managePositionId === p.id
                    return (
                      <tr
                        key={p.id}
                        onClick={() => {
                          setActiveSymbol(p.symbol)
                          beginManage(p.id)
                        }}
                        className={cn("group cursor-pointer border-b border-border/60 transition-colors", managing ? "bg-volt/10" : "hover:bg-accent/50")}
                      >
                        <Td mono={false} className="font-semibold">
                          {p.symbol}
                        </Td>
                        <Td mono={false}>
                          <DirChip direction={p.direction} />
                        </Td>
                        <Td right>{p.volume}</Td>
                        <Td className={cn("text-muted-foreground", WIDE)}>{stamp(p.openedAt)}</Td>
                        <Td right>{formatPrice(p.entryPrice, asset.digits)}</Td>
                        <Td right>{formatPrice(price, asset.digits)}</Td>
                        <Td right className={p.stopLoss != null ? "text-loss" : "text-muted-foreground"}>
                          {p.stopLoss != null ? formatPrice(p.stopLoss, asset.digits) : "—"}
                        </Td>
                        <Td right className={p.takeProfit != null ? "text-profit" : "text-muted-foreground"}>
                          {p.takeProfit != null ? formatPrice(p.takeProfit, asset.digits) : "—"}
                        </Td>
                        <Td right className={cn("text-muted-foreground", MID)}>
                          {formatMoney(p.margin)}
                        </Td>
                        <Td right className={cn("font-semibold", pnlTone(pnl))}>
                          {money(pnl, { sign: true })}
                        </Td>
                        <Td right mono={false}>
                          <div className="flex items-center justify-end gap-0.5 opacity-60 transition-opacity group-hover:opacity-100">
                            <RowAction label="Modify stop, target or close part" onClick={() => beginManage(p.id)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </RowAction>
                            <RowAction label="Move stop loss to breakeven" disabled={pnl <= 0} onClick={() => modifyPosition(p.id, p.entryPrice, p.takeProfit ?? null)}>
                              <Equal className="h-3.5 w-3.5" />
                            </RowAction>
                            <RowAction
                              label="Close half"
                              disabled={p.volume <= asset.lotStep}
                              onClick={() => {
                                const half = roundToLotStep(p.volume / 2, asset.lotStep)
                                if (half >= asset.lotStep) partialClose(p.id, half)
                              }}
                            >
                              <Scissors className="h-3.5 w-3.5" />
                            </RowAction>
                            <RowAction label="Close at market" danger onClick={() => closePosition(p.id)}>
                              <X className="h-3.5 w-3.5" />
                            </RowAction>
                          </div>
                        </Td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          )
        ) : null}

        {tab === "pending" ? (
          pendingOrders.length === 0 ? (
            <Empty icon={Inbox} title="No pending orders" text="Limit and stop orders wait here until the price reaches them." />
          ) : (
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-border">
                  <Th>Symbol</Th>
                  <Th>Side</Th>
                  <Th>Type</Th>
                  <Th right>Volume</Th>
                  <Th className={WIDE}>Placed</Th>
                  <Th right>Trigger</Th>
                  <Th right>Current</Th>
                  <Th right className={MID}>
                    Distance
                  </Th>
                  <Th right>S/L</Th>
                  <Th right>T/P</Th>
                  <Th right>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {pendingOrders.map((o) => {
                  const asset = getAsset(o.symbol)
                  const price = prices[o.symbol] ?? o.triggerPrice
                  return (
                    <tr
                      key={o.id}
                      onClick={() => {
                        setActiveSymbol(o.symbol)
                        beginManage(o.id)
                      }}
                      className={cn("group cursor-pointer border-b border-border/60 transition-colors", managePositionId === o.id ? "bg-volt/10" : "hover:bg-accent/50")}
                    >
                      <Td mono={false} className="font-semibold">
                        {o.symbol}
                      </Td>
                      <Td mono={false}>
                        <DirChip direction={o.direction} />
                      </Td>
                      <Td mono={false} className="text-[11px] font-semibold text-muted-foreground uppercase">
                        {o.type}
                      </Td>
                      <Td right>{o.volume}</Td>
                      <Td className={cn("text-muted-foreground", WIDE)}>{stamp(o.createdAt)}</Td>
                      <Td right className="font-semibold">
                        {formatPrice(o.triggerPrice, asset.digits)}
                      </Td>
                      <Td right>{formatPrice(price, asset.digits)}</Td>
                      <Td right className={cn("text-muted-foreground", MID)}>
                        {Math.round(Math.abs(price - o.triggerPrice) * 10 ** asset.digits).toLocaleString("en-US")} pts
                      </Td>
                      <Td right className={o.stopLoss != null ? "text-loss" : "text-muted-foreground"}>
                        {o.stopLoss != null ? formatPrice(o.stopLoss, asset.digits) : "—"}
                      </Td>
                      <Td right className={o.takeProfit != null ? "text-profit" : "text-muted-foreground"}>
                        {o.takeProfit != null ? formatPrice(o.takeProfit, asset.digits) : "—"}
                      </Td>
                      <Td right mono={false}>
                        <div className="flex items-center justify-end gap-0.5 opacity-60 transition-opacity group-hover:opacity-100">
                          <RowAction label="Modify order" onClick={() => beginManage(o.id)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </RowAction>
                          <RowAction label="Cancel order" danger onClick={() => cancelPending(o.id)}>
                            <X className="h-3.5 w-3.5" />
                          </RowAction>
                        </div>
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )
        ) : null}

        {tab === "history" ? (
          deals.length === 0 ? (
            <Empty icon={HistoryIcon} title="No closed trades" text={period === "all" ? "Closed trades on this account show up here, newest first." : "Nothing closed in this period."} />
          ) : (
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-border">
                  <Th>Symbol</Th>
                  <Th>Side</Th>
                  <Th right>Volume</Th>
                  <Th className={WIDE}>Opened</Th>
                  <Th>Closed</Th>
                  <Th right>Open price</Th>
                  <Th right>Close price</Th>
                  <Th right className={MID}>S/L</Th>
                  <Th right className={MID}>T/P</Th>
                  <Th right className={MID}>
                    Held
                  </Th>
                  <Th className={MID}>Closed by</Th>
                  <Th right>P/L</Th>
                </tr>
              </thead>
              <tbody>
                {deals.map((t) => {
                  const asset = getAsset(t.symbol)
                  return (
                    <tr key={`${t.id}-${t.closedAt}`} className="border-b border-border/60 hover:bg-accent/40">
                      <Td mono={false} className="font-semibold">
                        {t.symbol}
                      </Td>
                      <Td mono={false}>
                        <DirChip direction={t.direction} />
                      </Td>
                      <Td right>{t.volume}</Td>
                      <Td className={cn("text-muted-foreground", WIDE)}>{stamp(t.openedAt)}</Td>
                      <Td className="text-muted-foreground">{stamp(t.closedAt)}</Td>
                      <Td right>{formatPrice(t.entryPrice, asset.digits)}</Td>
                      <Td right>{formatPrice(t.exitPrice, asset.digits)}</Td>
                      <Td right className={cn("text-[11px]", MID, t.stopLoss != null ? "text-loss" : "text-muted-foreground")}>
                        {t.stopLoss != null ? formatPrice(t.stopLoss, asset.digits) : "—"}
                      </Td>
                      <Td right className={cn("text-[11px]", MID, t.takeProfit != null ? "text-profit" : "text-muted-foreground")}>
                        {t.takeProfit != null ? formatPrice(t.takeProfit, asset.digits) : "—"}
                      </Td>
                      <Td right className={cn("text-muted-foreground", MID)}>
                        {duration(t.closedAt - t.openedAt)}
                      </Td>
                      <Td mono={false} className={cn("text-[11.5px]", MID, t.reason === "breach" ? "text-loss" : "text-muted-foreground")}>
                        {REASON[t.reason] ?? t.reason}
                      </Td>
                      <Td right className={cn("font-semibold", pnlTone(t.realizedPnl))}>
                        {money(t.realizedPnl, { sign: true })}
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )
        ) : null}

        {tab === "objectives" ? (
          <div className="p-3">
            <Objectives />
          </div>
        ) : null}
      </div>

      {showRecordModal && accountId && (
        <CreateTradeRecordModal
          open={showRecordModal}
          onClose={() => setShowRecordModal(false)}
          accountId={accountId}
        />
      )}
    </section>
  )
}
