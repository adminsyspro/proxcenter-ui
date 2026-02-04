import http from "node:http"
import { WebSocketServer, WebSocket } from "ws"

const PORT = Number(process.env.CONSOLE_PROXY_PORT || 3001)
const NEXT_BASE = process.env.NEXT_BASE_URL || "http://localhost:3000"

async function consumeSession(sessionId) {
  const res = await fetch(`${NEXT_BASE}/api/internal/console/consume`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  })
  if (!res.ok) return null
  const json = await res.json()
  return json?.data || null
}

const wss = new WebSocketServer({ noServer: true })
const server = http.createServer()

server.on("upgrade", async (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const m = url.pathname.match(/^\/ws\/console\/([^/]+)$/)
  if (!m) return socket.destroy()

  const sessionId = m[1]
  const session = await consumeSession(sessionId)
  if (!session) return socket.destroy()

  wss.handleUpgrade(req, socket, head, (clientWs) => {
    wss.emit("connection", clientWs, session)
  })
})

wss.on("connection", (clientWs, session) => {
  const { conn, node, type, vmid, port, ticket } = session

  const base = conn.baseUrl.replace(/\/$/, "")
  const upstreamUrl =
    `${base}/api2/json/nodes/${encodeURIComponent(node)}/${encodeURIComponent(type)}/${encodeURIComponent(vmid)}` +
    `/vncwebsocket?port=${encodeURIComponent(port)}&vncticket=${encodeURIComponent(ticket)}`

  const upstreamWs = new WebSocket(upstreamUrl, {
    rejectUnauthorized: conn.insecureDev ? false : true,
    headers: { Authorization: `PVEAPIToken=${conn.apiToken}` },
  })

  const closeBoth = () => {
    try { clientWs.close() } catch {}
    try { upstreamWs.close() } catch {}
  }

  upstreamWs.on("open", () => {
    clientWs.on("message", (msg) => upstreamWs.readyState === 1 && upstreamWs.send(msg))
    upstreamWs.on("message", (msg) => clientWs.readyState === 1 && clientWs.send(msg))
  })

  clientWs.on("close", closeBoth)
  upstreamWs.on("close", closeBoth)
  clientWs.on("error", closeBoth)
  upstreamWs.on("error", closeBoth)
})

server.listen(PORT, () => {
  console.log(`Console proxy listening on ws://localhost:${PORT}`)
})

