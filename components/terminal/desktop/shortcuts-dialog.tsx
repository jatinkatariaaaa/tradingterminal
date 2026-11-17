"use client"

import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { OPEN_SHORTCUTS } from "./events"

const GROUPS: { title: string; keys: [string[], string][] }[] = [
  {
    title: "Orders",
    keys: [
      [["B"], "Set the ticket to buy"],
      [["S"], "Set the ticket to sell"],
      [["Shift", "X"], "Close all open positions (asks first)"],
      [["Esc"], "Leave the position manager"],
    ],
  },
  {
    title: "Navigate",
    keys: [
      [["Ctrl", "K"], "Search symbols and actions"],
      [["/"], "Search symbols and actions"],
      [["?"], "Show these shortcuts"],
    ],
  },
  {
    title: "Chart",
    keys: [
      [["Drag line"], "Move a stop loss, take profit or pending order on the chart"],
      [["Scroll"], "Zoom the time axis"],
    ],
  },
]

export function ShortcutsDialog() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const show = () => setOpen(true)
    window.addEventListener(OPEN_SHORTCUTS, show)
    return () => window.removeEventListener(OPEN_SHORTCUTS, show)
  }, [])
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="rounded-2xl sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Shortcuts work anywhere in the terminal except while you are typing in a field.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-5">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h3 className="mb-2 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">{g.title}</h3>
              <ul className="divide-y divide-border rounded-xl border border-border">
                {g.keys.map(([keys, label]) => (
                  <li key={label + keys.join()} className="flex items-center justify-between gap-4 px-3 py-2 text-[13px]">
                    <span>{label}</span>
                    <span className="flex shrink-0 gap-1">
                      {keys.map((k) => (
                        <kbd key={k} className="min-w-[24px] rounded-md border border-border bg-secondary px-1.5 py-0.5 text-center font-mono text-[11px] font-semibold">
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
