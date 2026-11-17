"use client"

import type { ComponentType } from "react"
import { Calculator, Gauge, Keyboard, LifeBuoy, ListOrdered } from "lucide-react"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { SITE_URL } from "../brand"
import { openShortcuts } from "./events"

export type LeftPanel = "watch" | "account" | "calc"

const ITEMS: { key: LeftPanel; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { key: "watch", label: "Market watch", icon: ListOrdered },
  { key: "account", label: "Account and objectives", icon: Gauge },
  { key: "calc", label: "Position size calculator", icon: Calculator },
]

function RailButton({ label, icon: Icon, active, onClick, href }: { label: string; icon: ComponentType<{ className?: string }>; active?: boolean; onClick?: () => void; href?: string }) {
  const cls = cn(
    "relative grid h-10 w-10 place-items-center rounded-xl transition-colors",
    active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
  )
  const inner = (
    <>
      {active ? <span className="absolute top-2 -left-[7px] h-6 w-[3px] rounded-r-full bg-volt" /> : null}
      <Icon className="h-[18px] w-[18px]" />
    </>
  )
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {href ? (
          <a href={href} target="_blank" rel="noreferrer" aria-label={label} className={cls}>
            {inner}
          </a>
        ) : (
          <button type="button" onClick={onClick} aria-label={label} aria-pressed={active} className={cls}>
            {inner}
          </button>
        )}
      </TooltipTrigger>
      <TooltipContent side="right" className="text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

/** Slim icon rail on the far left: switches the left panel, and folds it away when the active one is clicked again. */
export function SideRail({ active, onPick }: { active: LeftPanel | null; onPick: (k: LeftPanel) => void }) {
  return (
    <nav aria-label="Panels" className="flex w-[52px] shrink-0 flex-col items-center gap-1.5 border-r border-border bg-card py-2">
      {ITEMS.map((it) => (
        <RailButton key={it.key} label={it.label} icon={it.icon} active={active === it.key} onClick={() => onPick(it.key)} />
      ))}
      <span className="mt-auto" />
      <RailButton label="Keyboard shortcuts" icon={Keyboard} onClick={openShortcuts} />
      <RailButton label="Help centre" icon={LifeBuoy} href={`${SITE_URL}/faqs`} />
    </nav>
  )
}
