"use client"

import { useState, useEffect, useMemo } from "react"
import {
  X,
  PlusCircle,
  TrendingUp,
  TrendingDown,
  ArrowRight,
  Clock,
  Sparkles,
  BarChart3,
  Calendar,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { getAsset, formatPrice, ASSETS } from "@/lib/trading/assets"
import { useTrading } from "./trading-provider"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"

interface CreateTradeRecordModalProps {
  open: boolean
  onClose: () => void
  accountId: string
}

// Group assets by category for pair selection
const PAIR_GROUPS = [
  {
    category: "Commodities & Metals",
    pairs: ["XAUUSD", "XAGUSD", "USOIL", "WTIUSD"],
  },
  {
    category: "Forex Majors",
    pairs: ["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "USDCAD", "AUDUSD", "NZDUSD"],
  },
  {
    category: "Forex Crosses",
    pairs: ["GBPJPY", "EURJPY", "EURGBP", "EURAUD", "GBPAUD", "AUDJPY", "CHFJPY"],
  },
  {
    category: "Crypto",
    pairs: ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
  },
]

export function CreateTradeRecordModal({ open, onClose, accountId }: { open: boolean; onClose: () => void; accountId: string }) {
  const { setActiveSymbol, activeSymbol, prices } = useTrading()
  const [selectedPair, setSelectedPair] = useState<string>(activeSymbol || "XAUUSD")
  const [direction, setDirection] = useState<"buy" | "sell">("buy")
  const [volume, setVolume] = useState<number>(1.0)
  const [openPrice, setOpenPrice] = useState<string>("")
  const [closePrice, setClosePrice] = useState<string>("")
  const [stopLoss, setStopLoss] = useState<string>("")
  const [takeProfit, setTakeProfit] = useState<string>("")
  const [reason, setReason] = useState<"tp" | "sl" | "manual">("tp")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // Default past times: open 4 hours ago, close 1 hour ago
  const [openTime, setOpenTime] = useState<string>(() => {
    const d = new Date(Date.now() - 4 * 60 * 60 * 1000)
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
  })
  const [closeTime, setCloseTime] = useState<string>(() => {
    const d = new Date(Date.now() - 1 * 60 * 60 * 1000)
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
  })

  // Whenever selected pair changes, switch main chart to it and set reference price
  const handleSelectPair = (pair: string) => {
    setSelectedPair(pair)
    setActiveSymbol(pair)
    const cur = prices[pair] ?? getAsset(pair).basePrice
    if (!openPrice) {
      setOpenPrice(String(cur))
      // default close with small profit
      const sign = direction === "buy" ? 1 : -1
      const step = pair.includes("JPY") ? 0.5 : pair.includes("XAU") ? 5.0 : pair.includes("BTC") ? 500 : 0.005
      setClosePrice(String(cur + step * sign))
    }
  }

  // Pre-fill on open if empty
  useEffect(() => {
    if (open && selectedPair) {
      const cur = prices[selectedPair] ?? getAsset(selectedPair).basePrice
      if (!openPrice) {
        setOpenPrice(String(cur))
        const step = selectedPair.includes("JPY") ? 0.5 : selectedPair.includes("XAU") ? 5.0 : selectedPair.includes("BTC") ? 500 : 0.005
        setClosePrice(String(cur + step))
      }
    }
  }, [open, selectedPair, prices])

  // Calculation metrics
  const calculation = useMemo(() => {
    const op = parseFloat(openPrice)
    const cp = parseFloat(closePrice)
    const vol = parseFloat(String(volume)) || 0

    if (isNaN(op) || isNaN(cp) || vol <= 0) {
      return { grossPnl: 0, commission: 0, netPnl: 0, pips: 0 }
    }

    const asset = getAsset(selectedPair)
    const sign = direction === "buy" ? 1 : -1
    const priceDiff = (cp - op) * sign

    // PnL based on contract size
    const grossPnl = priceDiff * vol * asset.contractSize
    const commission = vol * 6
    const netPnl = grossPnl - commission

    // Calculate pips / points
    const pips = priceDiff * Math.pow(10, asset.digits - (selectedPair.includes("JPY") ? 2 : 4))

    return {
      grossPnl: Number(grossPnl.toFixed(2)),
      commission: Number(commission.toFixed(2)),
      netPnl: Number(netPnl.toFixed(2)),
      pips: Number(pips.toFixed(1)),
    }
  }, [selectedPair, direction, volume, openPrice, closePrice])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const res = await fetch("/api/trade/create-record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId,
          symbol: selectedPair,
          direction,
          volume,
          openPrice: parseFloat(openPrice),
          closePrice: parseFloat(closePrice),
          openTime: new Date(openTime).toISOString(),
          closeTime: new Date(closeTime).toISOString(),
          stopLoss: stopLoss ? parseFloat(stopLoss) : null,
          takeProfit: takeProfit ? parseFloat(takeProfit) : null,
          reason,
          grossPnl: calculation.grossPnl,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || "Failed to create trade record")
      }

      setSuccess(true)
      setTimeout(() => {
        setSuccess(false)
        onClose()
      }, 1200)
    } catch (err: any) {
      setError(err.message || "Failed to create trade record")
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="relative w-full max-w-2xl rounded-2xl border border-border bg-card p-6 shadow-2xl my-8">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-volt/15 text-volt">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold tracking-tight text-foreground">Create Trade Record</h2>
              <p className="text-xs text-muted-foreground">Record historical demo trades with custom entries, targets, and profits.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <div className="mt-4 flex items-center gap-2 rounded-xl bg-loss/15 p-3 text-xs font-semibold text-loss border border-loss/30">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="mt-4 flex items-center gap-2 rounded-xl bg-profit/15 p-3 text-xs font-semibold text-profit border border-profit/30">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>Trade record created successfully! Updating history...</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-5 space-y-5">
          {/* 1. Pair Selector */}
          <div>
            <label className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase mb-2 block">
              1. Select Asset Pair (Switches chart in real-time)
            </label>
            <div className="space-y-2.5 bg-secondary/30 rounded-xl p-3 border border-border/60">
              {PAIR_GROUPS.map((group) => (
                <div key={group.category}>
                  <span className="text-[10px] font-medium text-muted-foreground/80 uppercase block mb-1">
                    {group.category}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {group.pairs.map((p) => {
                      const isSelected = selectedPair === p
                      return (
                        <button
                          key={p}
                          type="button"
                          onClick={() => handleSelectPair(p)}
                          className={cn(
                            "px-2.5 py-1 rounded-lg text-xs font-mono font-semibold transition-all cursor-pointer",
                            isSelected
                              ? "bg-volt text-volt-foreground shadow-sm ring-1 ring-volt"
                              : "bg-card border border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
                          )}
                        >
                          {p}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 2. Direction & Volume */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase mb-1.5 block">
                Direction
              </label>
              <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-secondary/40 border border-border/60">
                <button
                  type="button"
                  onClick={() => setDirection("buy")}
                  className={cn(
                    "flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-all",
                    direction === "buy"
                      ? "bg-profit text-white shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <TrendingUp className="h-3.5 w-3.5" /> BUY
                </button>
                <button
                  type="button"
                  onClick={() => setDirection("sell")}
                  className={cn(
                    "flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-all",
                    direction === "sell"
                      ? "bg-loss text-white shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <TrendingDown className="h-3.5 w-3.5" /> SELL
                </button>
              </div>
            </div>

            <div>
              <label className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase mb-1.5 block">
                Volume / Lots
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={volume}
                onChange={(e) => setVolume(parseFloat(e.target.value) || 0)}
                className="w-full h-10 px-3 rounded-xl bg-card border border-border text-sm font-mono font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-volt"
                required
              />
            </div>
          </div>

          {/* 3. Entry and Close Prices & Timestamps */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 rounded-xl bg-secondary/20 border border-border/60">
            {/* Entry side */}
            <div className="space-y-3">
              <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                <span className="h-2 w-2 rounded-full bg-volt" />
                <span>Entry Details (Past)</span>
              </div>
              <div>
                <label className="text-[10.5px] text-muted-foreground uppercase block mb-1">
                  Entry Price
                </label>
                <input
                  type="number"
                  step="any"
                  value={openPrice}
                  onChange={(e) => setOpenPrice(e.target.value)}
                  placeholder="e.g. 2650.00"
                  className="w-full h-9 px-3 rounded-lg bg-card border border-border text-xs font-mono font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-volt"
                  required
                />
              </div>
              <div>
                <label className="text-[10.5px] text-muted-foreground uppercase block mb-1">
                  Entry Date & Time
                </label>
                <input
                  type="datetime-local"
                  value={openTime}
                  onChange={(e) => setOpenTime(e.target.value)}
                  className="w-full h-9 px-3 rounded-lg bg-card border border-border text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-volt"
                  required
                />
              </div>
            </div>

            {/* Exit side */}
            <div className="space-y-3">
              <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                <span className="h-2 w-2 rounded-full bg-profit" />
                <span>Exit Details (Close)</span>
              </div>
              <div>
                <label className="text-[10.5px] text-muted-foreground uppercase block mb-1">
                  Close Price
                </label>
                <input
                  type="number"
                  step="any"
                  value={closePrice}
                  onChange={(e) => setClosePrice(e.target.value)}
                  placeholder="e.g. 2670.00"
                  className="w-full h-9 px-3 rounded-lg bg-card border border-border text-xs font-mono font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-volt"
                  required
                />
              </div>
              <div>
                <label className="text-[10.5px] text-muted-foreground uppercase block mb-1">
                  Close Date & Time
                </label>
                <input
                  type="datetime-local"
                  value={closeTime}
                  onChange={(e) => setCloseTime(e.target.value)}
                  className="w-full h-9 px-3 rounded-lg bg-card border border-border text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-volt"
                  required
                />
              </div>
            </div>
          </div>

          {/* 4. Protective Levels (Stop Loss & Take Profit) */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase mb-1.5 block">
                Stop Loss (Optional)
              </label>
              <input
                type="number"
                step="any"
                value={stopLoss}
                onChange={(e) => setStopLoss(e.target.value)}
                placeholder="SL price"
                className="w-full h-9 px-3 rounded-xl bg-card border border-border text-xs font-mono text-loss font-semibold focus:outline-none focus:ring-1 focus:ring-volt"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase mb-1.5 block">
                Target / T/P (Optional)
              </label>
              <input
                type="number"
                step="any"
                value={takeProfit}
                onChange={(e) => setTakeProfit(e.target.value)}
                placeholder="TP price"
                className="w-full h-9 px-3 rounded-xl bg-card border border-border text-xs font-mono text-profit font-semibold focus:outline-none focus:ring-1 focus:ring-volt"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase mb-1.5 block">
                Close Reason
              </label>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value as any)}
                className="w-full h-9 px-3 rounded-xl bg-card border border-border text-xs font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-volt"
              >
                <option value="tp">Take Profit (TP)</option>
                <option value="sl">Stop Loss (SL)</option>
                <option value="manual">Manual Close</option>
              </select>
            </div>
          </div>

          {/* 5. Live Profit / Calculation Preview Card */}
          <div className="rounded-xl p-4 bg-card border border-border/80 flex items-center justify-between">
            <div>
              <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase block mb-1">
                Projected Profit Summary
              </span>
              <div className="flex items-baseline gap-2">
                <span
                  className={cn(
                    "text-xl font-bold font-mono",
                    calculation.netPnl >= 0 ? "text-profit" : "text-loss"
                  )}
                >
                  {calculation.netPnl >= 0 ? "+" : ""}${calculation.netPnl.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                </span>
                <span className="text-xs text-muted-foreground">
                  (Gross: ${calculation.grossPnl} · Comm: -${calculation.commission})
                </span>
              </div>
            </div>
            <div className="text-right">
              <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase block mb-1">
                Points / Pips
              </span>
              <span className={cn("text-sm font-mono font-bold", calculation.pips >= 0 ? "text-profit" : "text-loss")}>
                {calculation.pips >= 0 ? "+" : ""}{calculation.pips} pts
              </span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 rounded-xl border border-border text-xs font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-volt hover:opacity-90 text-volt-foreground text-xs font-bold transition-all shadow-md active:scale-[0.98] disabled:opacity-50 cursor-pointer"
            >
              {loading ? "Recording Trade..." : "Record Trade to History"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
