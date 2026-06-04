import { NextResponse } from "next/server"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { putSingleUse, takeSingleUse } from "@/lib/console/session"

export const runtime = "nodejs"

// In-memory short-lived terminal sessions. Same MVP store as the VM
// console flow (see consoles route): keyed by random UUID, single-use,
// expires after 30 s to leave headroom for slow ws-proxy hops. The
// ws-proxy process consumes the session via /api/internal/shell/consume
// (gated by APP_SECRET) and then opens the WebSocket to PVE on the
// browser's behalf. The apiToken NEVER leaves the server: previously
// this route returned conn.apiToken in the JSON payload, allowing any
// user with node.console permission to scrape the long-lived PVE token
// from DevTools (audit finding NEW-C).
type TerminalSession = {
  baseUrl: string
  host: string
  pvePort: number
  apiToken: string
  // Mirrors the connection's insecureTLS flag so ws-proxy can decide
  // whether to enable certificate verification on the PVE WebSocket
  // hop. False means strict TLS (matches H7 backend behaviour).
  insecure: boolean
  node: string
  port: number
  ticket: string
  user: string
  upid: string
  expiresAt: number
}

/**
 * POST /api/v1/connections/[id]/nodes/[node]/terminal
 *
 * Creates a terminal (shell) session for a PVE node.
 * Proxmox API: POST /nodes/{node}/termproxy
 *
 * Returns only { sessionId, host, node, expiresAt } so the browser can
 * open ws://.../api/internal/ws/shell/{sessionId} without ever
 * receiving the underlying PVE API token.
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string; node: string }> }
) {
  try {
    const { id, node } = await ctx.params

    const denied = await checkPermission(PERMISSIONS.NODE_CONSOLE, "connection", id)
    if (denied) return denied

    const conn = await getConnectionById(id)
    if (!conn) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    let host = ''
    let pvePort = 8006
    try {
      const url = new URL(conn.baseUrl)
      host = url.hostname
      pvePort = url.port ? Number.parseInt(url.port) : 8006
    } catch {
      const match = conn.baseUrl.match(/https?:\/\/([^:/]+)(?::(\d+))?/)
      if (match) {
        host = match[1]
        pvePort = match[2] ? Number.parseInt(match[2]) : 8006
      }
    }

    if (!host) {
      return NextResponse.json({ error: "Could not determine host from connection" }, { status: 500 })
    }

    const termproxy = await pveFetch<any>(
      conn,
      `/nodes/${encodeURIComponent(node)}/termproxy`,
      {
        method: "POST",
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    )

    if (!termproxy || !termproxy.ticket) {
      return NextResponse.json({ error: "Failed to create terminal session" }, { status: 500 })
    }

    const expiresAt = Date.now() + 30_000
    const sessionId = putSingleUse({
      baseUrl: conn.baseUrl,
      host,
      pvePort,
      apiToken: conn.apiToken,
      insecure: conn.insecureDev,
      node,
      port: Number(termproxy.port),
      ticket: termproxy.ticket,
      user: termproxy.user,
      upid: termproxy.upid,
      expiresAt,
    } as TerminalSession)

    return NextResponse.json({
      data: {
        sessionId,
        host,
        node,
        expiresAt,
      }
    })
  } catch (e: any) {
    console.error("[terminal/node] Error:", e?.message)
    return NextResponse.json({ error: e?.message || "Failed to create terminal session" }, { status: 500 })
  }
}

// Server-only helper consumed by /api/internal/shell/consume. The
// session is single-use: removed from the map on first read so a leaked
// sessionId cannot be replayed by a second client. Returns null if the
// id is unknown or the entry has expired.
export function consumeTerminalSession(sessionId: string): TerminalSession | null {
  return takeSingleUse(sessionId) as TerminalSession | null
}
