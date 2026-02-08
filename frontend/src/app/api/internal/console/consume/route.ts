import { NextResponse } from "next/server"

import { consumeConsoleSession } from "@/app/api/v1/connections/[id]/guests/[type]/[node]/[vmid]/console/route"

export const runtime = "nodejs"

export async function POST(req: Request) {
  // Verify internal shared secret to prevent unauthorized access
  const internalSecret = process.env.INTERNAL_API_SECRET
  if (internalSecret) {
    const authHeader = req.headers.get("X-Internal-Secret")
    if (authHeader !== internalSecret) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
  }

  const { sessionId } = await req.json().catch(() => ({}))

  if (!sessionId) return NextResponse.json({ error: "Missing sessionId" }, { status: 400 })

  const s = consumeConsoleSession(sessionId)

  if (!s) return NextResponse.json({ error: "Session not found/expired" }, { status: 404 })

  // Retourner directement les infos nécessaires pour le proxy WS
  return NextResponse.json({
    baseUrl: s.conn?.baseUrl,
    apiToken: s.conn?.apiToken, // Token API pour l'authentification WebSocket
    insecureDev: !!s.conn?.insecureDev, // Respect connection TLS setting
    port: s.port,
    ticket: s.ticket,
    node: s.node,
    type: s.type,
    vmid: s.vmid,
  })
}
