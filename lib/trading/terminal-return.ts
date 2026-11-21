const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function terminalReturn(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/"
  const url = new URL(value, "https://terminal.invalid")
  if (url.pathname === "/") {
    const accountId = url.searchParams.get("accountId") ?? ""
    return uuid.test(accountId) ? "/?accountId=" + accountId : "/"
  }
  const segments = url.pathname.split("/")
  return segments.length === 3 && segments[1] === "trade-replays" && uuid.test(segments[2]) ? url.pathname : "/"
}
