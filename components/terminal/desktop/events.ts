/* Window events that let any control open the shared desktop overlays. */

export const OPEN_PALETTE = "tpp:palette"
export const OPEN_SHORTCUTS = "tpp:shortcuts"

export const openPalette = () => window.dispatchEvent(new CustomEvent(OPEN_PALETTE))
export const openShortcuts = () => window.dispatchEvent(new CustomEvent(OPEN_SHORTCUTS))

/** Trading sessions in local exchange hours, so daylight saving is handled by the time zone. */
export const SESSIONS = [
  { name: "Sydney", tz: "Australia/Sydney", open: 7, close: 16 },
  { name: "Tokyo", tz: "Asia/Tokyo", open: 9, close: 18 },
  { name: "London", tz: "Europe/London", open: 8, close: 17 },
  { name: "New York", tz: "America/New_York", open: 8, close: 17 },
] as const

export function sessionOpen(tz: string, open: number, close: number, at: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23", weekday: "short" }).formatToParts(at)
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0)
  const day = parts.find((p) => p.type === "weekday")?.value ?? "Mon"
  if (day === "Sat" || day === "Sun") return false
  return hour >= open && hour < close
}

/** When a closed FX or metals market opens again: Sunday 22:00 UTC. */
export function nextFxOpen(at: Date): Date {
  const d = new Date(at)
  const day = d.getUTCDay()
  const daysToSunday = (7 - day) % 7
  const open = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + daysToSunday, 22, 0, 0))
  if (open <= at) open.setUTCDate(open.getUTCDate() + 7)
  return open
}

export function untilLabel(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000))
  const h = Math.floor(m / 60)
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`
  if (h > 0) return `${h}h ${m % 60}m`
  return `${m}m`
}
