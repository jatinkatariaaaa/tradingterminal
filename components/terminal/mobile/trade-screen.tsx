"use client"

import { useEffect, useState } from "react"
import { CandlestickChart, Layers, ListX, Pencil, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatPrice, getAsset } from "@/lib/trading/assets"
import type { OpenPosition } from "@/lib/trading/types"
import { useMarket, useTradingActions, useTradingState, type PendingOrder } from "../trading-provider"
import { DirChip, money, pnlTone, Row } from "../kit"
import { accountTitle } from "../account-switcher"
import { Empty, IconBtn, ScreenHeader, SectionLabel, stamp } from "./ui"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

/** A button that asks for a second tap before it acts, so a stray touch never closes a trade. */
function ConfirmButton({ label, confirmLabel, onConfirm, className }: { label: string; confirmLabel: string; onConfirm: () => void; className?: string }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(t)
  }, [armed])
  return (
    <button
      type="button"
      onClick={() => (armed ? (setArmed(false), onConfirm()) : setArmed(true))}
      className={cn("h-10 rounded-xl text-[13px] font-semibold transition-colors", armed ? "bg-sell text-sell-foreground" : "bg-sell/12 text-sell", className)}
    >
      {armed ? confirmLabel : label}
    </button>
  )
}

function Detail({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-[12px] text-muted-foreground">{k}</dt>
      <dd className={cn("font-mono text-[12.5px] font-medium tabular-nums", tone)}>{v}</dd>
    </div>
  )
}

function PositionRow({ p, open, onToggle, onModify, onChart }: { p: OpenPosition; open: boolean; onToggle: () => void; onModify: () => void; onChart: () => void }) {
  const { prices } = useMarket()
  const { pnlFor, closePosition } = useTradingActions()
  const asset = getAsset(p.symbol)
  const price = prices[p.symbol] ?? p.entryPrice
  const pnl = pnlFor(p, price)
  return (
    <li className={cn("transition-colors", open && "bg-card")}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-accent">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-[15px] font-semibold tracking-tight">{p.symbol}</span>
            <DirChip direction={p.direction} />
            <span className="font-mono text-[13px] text-muted-foreground tabular-nums">{p.volume}</span>
          </span>
          <span className="mt-0.5 block font-mono text-[12px] text-muted-foreground tabular-nums">
            {formatPrice(p.entryPrice, asset.digits)} → {formatPrice(price, asset.digits)}
          </span>
        </span>
        <span className={cn("font-mono text-[16px] font-semibold tabular-nums", pnlTone(pnl))}>{money(pnl, { sign: true })}</span>
      </button>
      {open ? (
        <div className="px-4 pb-4">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-xl bg-surface-2 p-3">
            <Detail k="S/L" v={p.stopLoss != null ? formatPrice(p.stopLoss, asset.digits) : "—"} tone={p.stopLoss != null ? "text-loss" : undefined} />
            <Detail k="T/P" v={p.takeProfit != null ? formatPrice(p.takeProfit, asset.digits) : "—"} tone={p.takeProfit != null ? "text-profit" : undefined} />
            <Detail k="Margin" v={money(p.margin)} />
            <Detail k="Ticket" v={`#${p.id.slice(0, 8)}`} />
            <div className="col-span-2">
              <Detail k="Opened" v={stamp(p.openedAt)} />
            </div>
          </dl>
          <div className="mt-3 grid grid-cols-[1fr_1fr_1.2fr] gap-2">
            <button type="button" onClick={onModify} className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-secondary text-[13px] font-semibold active:bg-accent">
              <Pencil className="h-3.5 w-3.5" /> Modify
            </button>
            <button type="button" onClick={onChart} className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-secondary text-[13px] font-semibold active:bg-accent">
              <CandlestickChart className="h-3.5 w-3.5" /> Chart
            </button>
            <ConfirmButton label="Close" confirmLabel={`Close ${money(pnl, { sign: true })}`} onConfirm={() => void closePosition(p.id)} />
          </div>
        </div>
      ) : null}
    </li>
  )
}

function OrderRow({ o, open, onToggle, onModify }: { o: PendingOrder; open: boolean; onToggle: () => void; onModify: () => void }) {
  const { prices } = useMarket()
  const { cancelPending } = useTradingActions()
  const asset = getAsset(o.symbol)
  const price = prices[o.symbol] ?? o.triggerPrice
  const distance = Math.abs(price - o.triggerPrice) * 10 ** asset.digits
  return (
    <li className={cn("transition-colors", open && "bg-card")}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-accent">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-[15px] font-semibold tracking-tight">{o.symbol}</span>
            <DirChip direction={o.direction} />
            <span className="text-[12px] font-semibold text-muted-foreground uppercase">{o.type}</span>
            <span className="font-mono text-[13px] text-muted-foreground tabular-nums">{o.volume}</span>
          </span>
          <span className="mt-0.5 block font-mono text-[12px] text-muted-foreground tabular-nums">
            at {formatPrice(o.triggerPrice, asset.digits)} · now {formatPrice(price, asset.digits)}
          </span>
        </span>
        <span className="text-right font-mono text-[12px] text-muted-foreground tabular-nums">{Math.round(distance).toLocaleString("en-US")} pts</span>
      </button>
      {open ? (
        <div className="px-4 pb-4">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-xl bg-surface-2 p-3">
            <Detail k="S/L" v={o.stopLoss != null ? formatPrice(o.stopLoss, asset.digits) : "—"} tone={o.stopLoss != null ? "text-loss" : undefined} />
            <Detail k="T/P" v={o.takeProfit != null ? formatPrice(o.takeProfit, asset.digits) : "—"} tone={o.takeProfit != null ? "text-profit" : undefined} />
            <Detail k="Placed at" v={formatPrice(o.placedPrice, asset.digits)} />
            <Detail k="Ticket" v={`#${o.id.slice(0, 8)}`} />
            <div className="col-span-2">
              <Detail k="Placed" v={stamp(o.createdAt)} />
            </div>
          </dl>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={onModify} className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-secondary text-[13px] font-semibold active:bg-accent">
              <Pencil className="h-3.5 w-3.5" /> Modify
            </button>
            <ConfirmButton label="Cancel order" confirmLabel="Tap to cancel" onConfirm={() => void cancelPending(o.id)} />
          </div>
        </div>
      ) : null}
    </li>
  )
}

export function TradeScreen({ onOpenChart, onModify }: { onOpenChart: () => void; onModify: (id: string) => void }) {
  const { derived } = useMarket()
  const { account, openPositions, pendingOrders, accounts, accountId } = useTradingState()
  const { closeAllPositions, setActiveSymbol } = useTradingActions()
  const [openId, setOpenId] = useState<string | null>(null)
  const [confirmAll, setConfirmAll] = useState(false)
  const current = accounts.find((a) => a.id === accountId)
  const pnl = derived.floatingPnl

  const toggle = (id: string) => setOpenId((v) => (v === id ? null : id))

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScreenHeader
        title="Trade"
        right={openPositions.length > 0 ? <IconBtn icon={ListX} label="Close all positions" tone="sell" onClick={() => setConfirmAll(true)} /> : null}
      />

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-6">
        <div className="px-4">
          <div className="rounded-[20px] border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="truncate text-[12.5px] font-medium text-muted-foreground">{current ? accountTitle(current) : account.label}</span>
              <span className="text-[11px] font-semibold text-muted-foreground uppercase">Floating P/L</span>
            </div>
            <p className={cn("mt-1 text-right font-mono text-[30px] leading-tight font-semibold tracking-tight tabular-nums", pnlTone(pnl))}>{money(pnl, { sign: true })}</p>
            <div className="mt-2 divide-y divide-border">
              <Row label="Balance" value={money(account.balance)} />
              <Row label="Equity" value={money(derived.equity)} />
              <Row label="Margin" value={money(derived.usedMargin)} />
              <Row label="Free margin" value={money(derived.freeMargin)} />
              <Row
                label="Margin level"
                value={derived.marginLevel == null ? "—" : `${derived.marginLevel.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`}
                tone={derived.marginLevel != null && derived.marginLevel < 150 ? "text-loss" : undefined}
              />
            </div>
          </div>
        </div>

        <SectionLabel right={openPositions.length ? <span className={cn("font-mono text-[12.5px] font-semibold tabular-nums", pnlTone(pnl))}>{money(pnl, { sign: true })}</span> : null}>
          Positions · {openPositions.length}
        </SectionLabel>
        {openPositions.length ? (
          <ul className="divide-y divide-border/60 border-y border-border/60">
            {[...openPositions]
              .sort((a, b) => b.openedAt - a.openedAt)
              .map((p) => (
                <PositionRow
                  key={p.id}
                  p={p}
                  open={openId === p.id}
                  onToggle={() => toggle(p.id)}
                  onModify={() => onModify(p.id)}
                  onChart={() => {
                    setActiveSymbol(p.symbol)
                    onOpenChart()
                  }}
                />
              ))}
          </ul>
        ) : (
          <Empty
            icon={Layers}
            title="No open positions"
            text={account.tradable ? "Pick a symbol in Quotes or on the chart and place your first trade." : "This account can't open new trades. Switch account in the Account tab."}
            action={
              account.tradable ? (
                <button type="button" onClick={onOpenChart} className="h-10 rounded-full bg-primary px-5 text-[13px] font-semibold text-primary-foreground">
                  New order
                </button>
              ) : null
            }
          />
        )}

        {pendingOrders.length ? (
          <>
            <SectionLabel>Orders · {pendingOrders.length}</SectionLabel>
            <ul className="divide-y divide-border/60 border-y border-border/60">
              {pendingOrders.map((o) => (
                <OrderRow key={o.id} o={o} open={openId === o.id} onToggle={() => toggle(o.id)} onModify={() => onModify(o.id)} />
              ))}
            </ul>
          </>
        ) : null}
      </div>

      <AlertDialog open={confirmAll} onOpenChange={setConfirmAll}>
        <AlertDialogContent className="max-w-[340px] rounded-[22px]">
          <AlertDialogHeader>
            <AlertDialogTitle>Close all {openPositions.length} positions?</AlertDialogTitle>
            <AlertDialogDescription>
              Every open position closes at market now, for a combined {money(pnl, { sign: true })}. Pending orders stay in place.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Keep them</AlertDialogCancel>
            <AlertDialogAction className="rounded-xl bg-sell text-sell-foreground hover:bg-sell/90" onClick={() => void closeAllPositions()}>
              <X className="h-4 w-4" /> Close all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

