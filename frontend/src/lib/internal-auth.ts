import { NextResponse } from "next/server"
import { timingSafeEqual } from "node:crypto"

// Server-side caller authentication for /api/internal/* routes. These
// routes are listed in publicApiRoutes in middleware.ts because they
// have to be reachable by the ws-proxy process without a NextAuth
// session, but that makes them reachable by anyone who can hit the
// Next.js port. A plain x-internal-caller string header is trivially
// spoofable: clients can attach any header value. The shared secret
// below closes that gap because APP_SECRET is server-side only (env
// var + .env file, never shipped to the browser) and the constant-time
// compare avoids leaking which character mismatched.
//
// ws-proxy sends both the x-internal-caller fingerprint (kept for
// existing log greps) and x-internal-secret = APP_SECRET. Any caller
// without the secret gets 403 with no further information.

const EXPECTED_CALLER = "proxcenter-ws-proxy"

function constantTimeStringEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8")
  const bb = Buffer.from(b, "utf8")
  if (ab.length !== bb.length) {
    // timingSafeEqual rejects mismatched length up front, so we
    // compare against an equal-length buffer and still return false.
    timingSafeEqual(ab, Buffer.alloc(ab.length))
    return false
  }
  return timingSafeEqual(ab, bb)
}

export function requireInternalCaller(req: Request): NextResponse | null {
  const caller = req.headers.get("x-internal-caller") || ""
  if (caller !== EXPECTED_CALLER) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const expected = process.env.APP_SECRET || ""
  if (!expected) {
    return NextResponse.json({ error: "Server misconfigured: APP_SECRET unset" }, { status: 500 })
  }
  const provided = req.headers.get("x-internal-secret") || ""
  if (!constantTimeStringEqual(provided, expected)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  return null
}
