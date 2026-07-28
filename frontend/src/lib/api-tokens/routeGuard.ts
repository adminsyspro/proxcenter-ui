// Explicit route-boundary guard for allowlisted routes (spec D2). Resolves
// the principal ONCE (recordUsage), enforces layer 1 (declared connection
// segment vs resolveVisibleConnectionIds BEFORE the handler), forwards the
// principal via ctx, and stamps RateLimit-* on token responses.
import { NextResponse } from "next/server"
import { headers } from "next/headers"

import { getPrincipal, rejectionToResponse, type Principal } from "@/lib/auth/principal"
import { getAllowlistEntryById, matchEntryParams } from "./allowlist"
import { resolveVisibleConnectionIds } from "./scope"

export type GuardedRouteContext = {
  params?: Promise<Record<string, string>> | Record<string, string>
  principal?: Principal
}

type GuardedHandler = (req: Request, ctx: GuardedRouteContext) => Promise<Response>

export function withPublicApiGuard(entryId: string, handler: GuardedHandler): GuardedHandler {
  return async (req, ctx) => {
    const result = await getPrincipal({ recordUsage: true })
    if (!result.ok) {
      return rejectionToResponse(result.rejection)
    }

    const principal = result.principal
    if (!principal || principal.kind !== "token") {
      // Session (or anonymous) caller: unchanged bit for bit, the handler's
      // own checkPermission does the work.
      return handler(req, ctx || {})
    }

    const entry = getAllowlistEntryById(entryId)
    if (!entry) return rejectionToResponse()

    // Entry pin (defence in depth): getPrincipal's scope verdict is only
    // valid for the entry named by x-pxc-entry, and this handler serves
    // exactly `entryId`. Any disagreement — a forged internal header if the
    // Edge stripping ever regresses, or a future overlapping pattern — fails
    // closed with the same 401 as every other disagreement, so the guard
    // never proceeds on a scope verdict borrowed from another entry.
    const hdrs = await headers()
    if (hdrs.get("x-pxc-entry") !== entryId) return rejectionToResponse()

    // Layer 1 (spec section 6): the entry declares its raw-connection-id
    // segment; validate it against the token perimeter BEFORE the handler
    // runs, independently of what the handler passes to checkPermission.
    if (entry.connectionSegment) {
      const params = matchEntryParams(entry, hdrs.get("x-pxc-path") || "")
      const connId = params ? params[entry.connectionSegment] : undefined
      if (!connId) return rejectionToResponse()
      const visible = await resolveVisibleConnectionIds(principal)
      if (!visible.has(connId)) {
        return NextResponse.json(
          { error: "Connection not in token scope", connection: connId },
          { status: 403 },
        )
      }
    }

    const res = await handler(req, { ...(ctx || {}), principal })
    if (result.rateLimit) {
      res.headers.set("RateLimit-Limit", String(result.rateLimit.limit))
      res.headers.set("RateLimit-Remaining", String(result.rateLimit.remaining))
      res.headers.set("RateLimit-Reset", String(result.rateLimit.reset))
    }
    return res
  }
}
