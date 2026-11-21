"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, ArrowRightLeft, Send } from "lucide-react"
import { cn } from "@/lib/utils"
import { ASSETS, bidAsk, commissionFor, formatPrice, getAsset, marginRequired, quoteCurrencyOf, spreadOf, usdPerUnit } from "@/lib/trading/assets"
import type { Direction } from "@/lib/trading/types"
import { useMarket, useTradingActions, useTradingState } from "../trading-provider"
import { pipSizeOf } from "../ticket/pip-utils"
import { money } from "../kit"

type Mode = "pct" | "usd"

function NumberField({ label, value, onChange, step, suffix, min = 0 }: { label: string; value: number; onChange: (v: number) => void; step: number; suffix?: string; min?: number }) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  return (
    <label className="grid min-w-0 gap-1">
      <span className="truncate text-[11.5px] font-medium text-muted-foreground">{label}</span>
      <span className="flex h-9 min-w-0 items-center rounded-lg border border-border bg-background px-2.5 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
        <input
          type="number"
          inputMode="decimal"
          step={step}
          min={min}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            const n = Number(e.target.value)
            if (e.target.value !== "" && Number.isFinite(n) && n >= min) onChange(n)
          }}
          className="w-full min-w-0 bg-transparent font-mono text-[13px] tabular-nums outline-none"
        />
        {suffix ? <span className="ml-1 shrink-0 text-[11px] text-muted-foreground">{suffix}</span> : null}
      </span>
    </label>
  )
}

/**
 * Position size calculator wired to the live account: size a trade from the risk
 * you choose and your stop distance, see it against today's loss room, then send
 * the size, stop and target straight to the order ticket.
 */
export function RiskCalculator() {
  const { prices, derived } = useMarket()
  const { activeSymbol, account } = useTradingState()
  const { setActiveSymbol, setDraft } = useTradingActions()

  const [symbol, setSymbol] = useState(activeSymbol)
  const [direction, setDirection] = useState<Direction>("buy")
  const [mode, setMode] = useState<Mode>("pct")
  const [risk, setRisk] = useState(1)
  const [slPips, setSlPips] = useState(20)
  const [rr, setRr] = useState(2)

  // Follow the chart: picking a symbol anywhere updates the calculator.
  useEffect(() => setSymbol(activeSymbol), [activeSymbol])

  const r = useMemo(() => {
    const asset = getAsset(symbol)
    const mid = prices[symbol] ?? NaN
    const { bid, ask } = bidAsk(mid, spreadOf(asset, mid))
    const entry = direction === "buy" ? ask : bid
    const pip = pipSizeOf(symbol)
    const usdRate = usdPerUnit(quoteCurrencyOf(symbol), prices)
    const pipValue = pip * asset.contractSize * usdRate
    const riskUsd = mode === "pct" ? (account.balance * risk) / 100 : risk
    const raw = slPips > 0 && pipValue > 0 ? riskUsd / (slPips * pipValue) : 0
    const lots = Math.max(asset.lotStep, Math.floor(raw / asset.lotStep + 1e-9) * asset.lotStep)
    const lotsFixed = Number(lots.toFixed(2))
    const actualRisk = lotsFixed * slPips * pipValue
    const commission = commissionFor(lotsFixed)
    const sign = direction === "buy" ? 1 : -1
    const sl = entry - sign * slPips * pip
    const tp = entry + sign * slPips * rr * pip
    const margin = marginRequired(asset, lotsFixed, entry, prices, account.leverage)
    const dailyLeft = Math.max(0, derived.dailyDrawdownLimit - derived.dailyDrawdownUsed)
    return { asset, entry, pipValue, riskUsd, lots: lotsFixed, actualRisk, commission, sl, tp, margin, dailyLeft, tooSmall: raw < asset.lotStep, reward: actualRisk * rr }
  }, [symbol, prices, direction, mode, risk, slPips, rr, account.balance, account.leverage, derived.dailyDrawdownLimit, derived.dailyDrawdownUsed])

  const send = () => {
    setActiveSymbol(symbol)
    setDraft({
      direction,
      type: "market",
      volume: r.lots,
      slEnabled: true,
      slPrice: Number(r.sl.toFixed(r.asset.digits)),
      tpEnabled: rr > 0,
      tpPrice: Number(r.tp.toFixed(r.asset.digits)),
    })
  }

  const overDaily = r.actualRisk + r.commission > r.dailyLeft && account.tradable
  const overMargin = r.margin > derived.freeMargin

  return (
    <aside className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5">
        <h2 className="text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">Position size</h2>
        <span className="font-mono text-[10.5px] text-muted-foreground tabular-nums">live</span>
      </div>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 pb-4 scrollbar-thin">
        <div className="grid min-w-0 gap-3">
          <label className="grid min-w-0 gap-1">
            <span className="text-[11.5px] font-medium text-muted-foreground">Symbol</span>
            <select value={symbol} onChange={(e) => setSymbol(e.target.value)} className="h-9 w-full min-w-0 rounded-lg border border-border bg-background px-2 text-[13px] font-semibold outline-none focus:border-ring">
              {ASSETS.map((a) => (
                <option key={a.symbol} value={a.symbol}>
                  {a.symbol} · {a.label}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-1 rounded-lg bg-secondary p-0.5">
            {(["buy", "sell"] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDirection(d)}
                className={cn("h-8 rounded-md text-[12.5px] font-semibold capitalize transition-colors", direction === d ? (d === "buy" ? "bg-buy text-buy-foreground" : "bg-sell text-sell-foreground") : "text-muted-foreground hover:text-foreground")}
              >
                {d}
              </button>
            ))}
          </div>

          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
            <NumberField label={mode === "pct" ? "Risk per trade" : "Risk amount"} value={risk} onChange={setRisk} step={mode === "pct" ? 0.1 : 10} suffix={mode === "pct" ? "%" : "USD"} />
            <button
              type="button"
              onClick={() => {
                setMode((m) => (m === "pct" ? "usd" : "pct"))
                setRisk((v) => (mode === "pct" ? Math.round((account.balance * v) / 100) : Number(((v / Math.max(1, account.balance)) * 100).toFixed(2))))
              }}
              className="flex h-9 shrink-0 items-center gap-1 rounded-lg border border-border px-2.5 text-[11.5px] font-semibold text-muted-foreground hover:text-foreground"
              title="Switch between percent and dollars"
            >
              <ArrowRightLeft className="h-3.5 w-3.5" /> {mode === "pct" ? "USD" : "%"}
            </button>
          </div>

          <div className="grid min-w-0 grid-cols-2 gap-2">
            <NumberField label="Stop loss" value={slPips} onChange={setSlPips} step={1} suffix="pips" min={0.1} />
            <NumberField label="Reward : risk" value={rr} onChange={setRr} step={0.5} suffix="R" />
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-border bg-background/60 p-3">
          <p className="text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase">Position size</p>
          <p className="mt-0.5 font-mono text-[26px] leading-tight font-semibold tracking-tight tabular-nums">
            {r.lots.toFixed(2)} <span className="text-[13px] text-muted-foreground">lots</span>
          </p>
          <dl className="mt-2 grid gap-1.5 border-t border-border pt-2 text-[12px]">
            {(
              [
                ["Risk at stop", money(r.actualRisk)],
                ["Reward at target", money(r.reward)],
                ["Pip value, 1 lot", money(r.pipValue)],
                ["Entry", formatPrice(r.entry, r.asset.digits)],
                ["Stop loss", formatPrice(r.sl, r.asset.digits)],
                ["Take profit", rr > 0 ? formatPrice(r.tp, r.asset.digits) : "—"],
                ["Commission", money(r.commission)],
                ["Margin", money(r.margin)],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="font-mono font-medium tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        {r.tooSmall ? (
          <p className="mt-3 flex items-start gap-2 rounded-lg bg-warning/12 px-3 py-2 text-[12px] text-warning">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> The smallest size, {r.asset.lotStep} lot, already risks more than you set.
          </p>
        ) : null}
        {overDaily ? (
          <p className="mt-3 flex items-start gap-2 rounded-lg bg-sell/10 px-3 py-2 text-[12px] text-sell">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> A full stop would take more than the {money(r.dailyLeft)} left in today&apos;s loss limit and breach the account.
          </p>
        ) : null}
        {overMargin ? (
          <p className="mt-3 flex items-start gap-2 rounded-lg bg-warning/12 px-3 py-2 text-[12px] text-warning">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Needs {money(r.margin)} margin; {money(derived.freeMargin)} is free.
          </p>
        ) : null}

        <button
          type="button"
          onClick={send}
          disabled={!account.tradable}
          className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <Send className="h-3.5 w-3.5" /> Send to order ticket
        </button>
        <p className="mt-2 text-center text-[11px] text-muted-foreground">Fills size, stop and target. You still confirm the order.</p>
      </div>
    </aside>
  )
}
