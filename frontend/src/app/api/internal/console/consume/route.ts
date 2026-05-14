import { timingSafeEqual } from "node:crypto"

import { NextResponse } from "next/server"

import { consumeConsoleSession } from "@/app/api/v1/connections/[id]/guests/[type]/[node]/[vmid]/console/route"

export const runtime = "nodejs"

function tokenMatches(provided: string | null, expected: string): boolean {
  if (!provided || !expected) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)

  if (a.length !== b.length) return false

return timingSafeEqual(a, b)
}

export async function POST(req: Request) {
  // Authenticate the WS proxy via a shared secret. The previous
  // x-internal-caller header was trivially forgeable from any browser
  // session, exposing baseUrl/apiToken/ticket to unauthenticated callers.
  const expected = process.env.INTERNAL_API_TOKEN || ""

  if (!expected) {
    return NextResponse.json(
      { error: "Server misconfigured: INTERNAL_API_TOKEN missing" },
      { status: 503 }
    )
  }

  const auth = req.headers.get("authorization") || ""
  const match = auth.match(/^Bearer\s+(.+)$/i)
  const provided = match ? match[1].trim() : null

  if (!tokenMatches(provided, expected)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { sessionId } = await req.json().catch(() => ({}))

  if (!sessionId) return NextResponse.json({ error: "Missing sessionId" }, { status: 400 })

  const s = consumeConsoleSession(sessionId)

  if (!s) return NextResponse.json({ error: "Session not found/expired" }, { status: 404 })

  // Retourner directement les infos nécessaires pour le proxy WS
  return NextResponse.json({
    baseUrl: s.baseUrl,
    apiToken: s.apiToken,
    port: s.port,
    ticket: s.ticket,
    node: s.node,
    type: s.type,
    vmid: s.vmid,
  })
}
