import { NextResponse } from "next/server"

import { consumeConsoleSession } from "@/app/api/v1/connections/[id]/guests/[type]/[node]/[vmid]/console/route"
import { requireInternalCaller } from "@/lib/internal-auth"

export const runtime = "nodejs"

export async function POST(req: Request) {
  // Defensive: gate behind APP_SECRET on top of the x-internal-caller
  // fingerprint. The fingerprint is trivially spoofable since this
  // route lives under publicApiRoutes; the secret is server-only.
  const denied = requireInternalCaller(req)
  if (denied) return denied

  const { sessionId } = await req.json().catch(() => ({}))

  if (!sessionId) return NextResponse.json({ error: "Missing sessionId" }, { status: 400 })

  const s = consumeConsoleSession(sessionId)

  if (!s) return NextResponse.json({ error: "Session not found/expired" }, { status: 404 })

  // Retourner directement les infos nécessaires pour le proxy WS
  return NextResponse.json({
    baseUrl: s.baseUrl,
    apiToken: s.apiToken,
    insecure: s.insecure,
    port: s.port,
    ticket: s.ticket,
    node: s.node,
    type: s.type,
    vmid: s.vmid,
  })
}
