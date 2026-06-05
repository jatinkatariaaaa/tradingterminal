import { WebSocketServer, WebSocket } from "ws"

let wss: WebSocketServer | null = null
const clients = new Set<WebSocket>()

export function startWsServer(port: number) {
  wss = new WebSocketServer({ port })

  wss.on("connection", (ws) => {
    clients.add(ws)
    ws.on("close", () => clients.delete(ws))
    ws.on("error", () => clients.delete(ws))
  })

  console.log(`[WS Server] Live price broadcasting started on port ${port}`)
}

export function broadcastPrice(symbol: string, price: number) {
  if (clients.size === 0) return

  const payload = JSON.stringify({ symbol, price, timestamp: Date.now() })
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload)
    }
  }
}
