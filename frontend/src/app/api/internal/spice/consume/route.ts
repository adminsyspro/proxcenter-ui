// .../internal/spice/consume/route.ts
import { NextResponse } from "next/server"

import { consumeSpiceSession } from "@/app/api/v1/connections/[id]/guests/[type]/[node]/[vmid]/spice/route"
import { requireInternalCaller } from "@/lib/internal-auth"

export const runtime = "nodejs"

// Server-to-server endpoint: the ws-proxy process trades a sessionId for
// the SPICE bridge params (proxyticket, 3128 address, tls port, ca,
// host-subject). Multi-read (one read per spice-html5 channel). Gated by
// APP_SECRET via requireInternalCaller.
export async function POST(req: Request) {
  const denied = requireInternalCaller(req)
  if (denied) return denied

  const { sessionId } = await req.json().catch(() => ({}))
  if (!sessionId) return NextResponse.json({ error: "Missing sessionId" }, { status: 400 })

  const s = consumeSpiceSession(sessionId)
  if (!s) return NextResponse.json({ error: "Session not found/expired" }, { status: 404 })

  return NextResponse.json({
    proxyticket: s.proxyticket,
    proxyHost: s.proxyHost,
    proxyPort: s.proxyPort,
    tlsPort: s.tlsPort,
    ca: s.ca,
    hostSubject: s.hostSubject,
    insecure: s.insecure,
    node: s.node,
    vmid: s.vmid,
  })
}
