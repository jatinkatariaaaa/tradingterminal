"use client"

import { ChevronDown, Clock3, Minus, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import { bidAsk, formatPrice, getAsset, roundToLotStep, spreadOf } from "@/lib/trading/assets"
import { isMarketOpen } from "@/lib/trading/market-hours"
import { useSessionStats } from "@/hooks/use-session-stats"
import { useMarket, useTradingActions, useTradingState } from "../trading-provider"
import { useQuickTrade } from "../chart/use-quick-trade"
import { LocalNumberInput } from "../ticket/fields"
import { BigPrice } from "../kit"
import { nextFxOpen, openPalette, untilLabel } from "./events"

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">{label}</dt>
      <dd className={cn("font-mono text-[12px] font-semibold tabular-nums", tone)}>{value}</dd>
    </div>
  )
}

/**
 * Desktop chart header: the symbol (click to search), market status, session
 * change, high, low and spread, and one-click trading with the lot size inline.
 */
export function DesktopChartHeader() {
  const { prices, marketPrice } = useMarket()
  const { activeSymbol, account, draft } = useTradingState()
  const { setDraft } = useTradingActions()
  const { fire, isSubmitting } = useQuickTrade()
  const stats = useSessionStats(prices)
  const asset = getAsset(activeSymbol)
  const spread = spreadOf(asset, marketPrice)
  const { bid, ask } = bidAsk(marketPrice, spread)
  const st = stats[activeSymbol]
  const open = isMarketOpen(asset.category)
  const base = st?.open ?? marketPrice
  const chg = base ? ((marketPrice - base) / base) * 100 : 0
  const volume = roundToLotStep(Math.max(asset.lotStep, draft.volume), asset.lotStep)
  const disabled = !Number.isFinite(marketPrice) || !account.tradable || isSubmitting || !open
  const step = (d: number) => setDraft({ volume: Math.max(asset.lotStep, Number((draft.volume + d).toFixed(2))) })

  return (
    <div className="@container border-b border-border">
      <div className="flex items-center gap-4 px-3 py-2">
      <button type="button" onClick={openPalette} className="flex shrink-0 items-center gap-1 rounded-lg py-1 pr-1.5 pl-2 transition-colors hover:bg-accent" aria-label="Change symbol">
        <span className="text-[17px] font-bold tracking-tight">{asset.symbol}</span>
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      </button>
      <div className="hidden min-w-0 shrink @[620px]:block">
        <p className="truncate text-[12px] text-muted-foreground">{asset.label}</p>
        {open ? (
          <p className="flex items-center gap-1.5 text-[11px] font-medium whitespace-nowrap text-profit">
            <span className="h-1.5 w-1.5 rounded-full bg-profit" /> Market open
          </p>
        ) : (
          <p className="flex items-center gap-1 text-[11px] font-medium whitespace-nowrap text-warning">
            <Clock3 className="h-3 w-3" /> Closed · opens in {untilLabel(nextFxOpen(new Date()).getTime() - Date.now())}
          </p>
        )}
      </div>

      <dl className="hidden shrink-0 items-center gap-5 border-l border-border pl-4 @[880px]:flex">
        <Stat label="Change" value={`${chg > 0 ? "+" : ""}${chg.toFixed(2)}%`} tone={chg > 0 ? "text-profit" : chg < 0 ? "text-loss" : undefined} />
        <Stat label="High" value={formatPrice(st?.high ?? marketPrice, asset.digits)} />
        <Stat label="Low" value={formatPrice(st?.low ?? marketPrice, asset.digits)} />
        <Stat label="Spread" value={`${Math.round(spread * 10 ** asset.digits)} pts`} />
      </dl>

      <div className="ml-auto flex shrink-0 items-stretch gap-1" role="group" aria-label="One-click trading">
        <button
          type="button"
          onClick={() => fire("sell")}
          disabled={disabled}
          title={`Sell ${volume} ${asset.symbol} at market, one click`}
          className="group flex min-w-[118px] flex-col items-start rounded-l-xl rounded-r-md bg-sell/12 px-3 py-1 text-sell transition-colors hover:bg-sell hover:text-sell-foreground disabled:pointer-events-none disabled:opacity-45"
        >
          <span className="text-[9.5px] font-bold tracking-[0.12em] uppercase opacity-80">Sell</span>
          <BigPrice price={bid} digits={asset.digits} className="text-[17px] text-current" tone={null} />
        </button>
        <div className="flex w-[104px] flex-col items-center justify-center rounded-md bg-secondary px-1">
          <span className="text-[9px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">Lots</span>
          <div className="flex items-center">
            <button type="button" onClick={() => step(-asset.lotStep * 10)} aria-label="Decrease lots" className="grid h-5 w-5 place-items-center rounded text-muted-foreground hover:text-foreground">
              <Minus className="h-3 w-3" />
            </button>
            <LocalNumberInput
              value={draft.volume}
              onChange={(v) => setDraft({ volume: v })}
              step={asset.lotStep}
              min={asset.lotStep}
              onBlurClamp={asset.lotStep}
              aria-label="Lots for one-click trading"
              className="h-5 w-14 min-w-0 border-0 bg-transparent px-0 text-center font-mono text-[12px] font-semibold tabular-nums shadow-none focus-visible:ring-0 dark:bg-transparent [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
            />
            <button type="button" onClick={() => step(asset.lotStep * 10)} aria-label="Increase lots" className="grid h-5 w-5 place-items-center rounded text-muted-foreground hover:text-foreground">
              <Plus className="h-3 w-3" />
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={() => fire("buy")}
          disabled={disabled}
          title={`Buy ${volume} ${asset.symbol} at market, one click`}
          className="flex min-w-[118px] flex-col items-end rounded-l-md rounded-r-xl bg-buy/12 px-3 py-1 text-buy transition-colors hover:bg-buy hover:text-buy-foreground disabled:pointer-events-none disabled:opacity-45"
        >
          <span className="text-[9.5px] font-bold tracking-[0.12em] uppercase opacity-80">Buy</span>
          <BigPrice price={ask} digits={asset.digits} className="text-[17px] text-current" tone={null} />
        </button>
      </div>
      </div>
    </div>
  )
}
