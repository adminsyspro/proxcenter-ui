import { NextResponse } from "next/server"

import { consumeTerminalSession } from "@/app/api/v1/connections/[id]/nodes/[node]/terminal/route"
import { requireInternalCaller } from "@/lib/internal-auth"

export const runtime = "nodejs"

// Server-to-server endpoint: the ws-proxy process trades a sessionId
// for the underlying PVE termproxy parameters (host, port, ticket,
// user, apiToken). Sister of /api/internal/console/consume for the
// node-shell flow. Gated by APP_SECRET via requireInternalCaller; the
// x-internal-caller fingerprint alone is trivially spoofable since
// /api/internal is in publicApiRoutes.
export async function POST(req: Request) {
  const denied = requireInternalCaller(req)
  if (denied) return denied

  const { sessionId } = await req.json().catch(() => ({}))
  if (!sessionId) return NextResponse.json({ error: "Missing sessionId" }, { status: 400 })

  const s = consumeTerminalSession(sessionId)
  if (!s) return NextResponse.json({ error: "Session not found/expired" }, { status: 404 })

  return NextResponse.json({
    baseUrl: s.baseUrl,
    host: s.host,
    pvePort: s.pvePort,
    apiToken: s.apiToken,
    insecure: s.insecure,
    node: s.node,
    port: s.port,
    ticket: s.ticket,
    user: s.user,
    upid: s.upid,
  })
}
