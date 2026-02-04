import { NextResponse } from "next/server"

import { consumeConsoleSession } from "@/app/api/v1/connections/[id]/guests/[type]/[node]/[vmid]/console/route"

export const runtime = "nodejs"

export async function POST(req: Request) {
  const { sessionId } = await req.json().catch(() => ({}))

  if (!sessionId) return NextResponse.json({ error: "Missing sessionId" }, { status: 400 })

  const s = consumeConsoleSession(sessionId)

  if (!s) return NextResponse.json({ error: "Session not found/expired" }, { status: 404 })

  // Retourner directement les infos nécessaires pour le proxy WS
  return NextResponse.json({
    baseUrl: s.conn?.baseUrl,
    apiToken: s.conn?.apiToken, // Token API pour l'authentification WebSocket
    port: s.port,
    ticket: s.ticket,
    node: s.node,
    type: s.type,
    vmid: s.vmid,
  })
}
