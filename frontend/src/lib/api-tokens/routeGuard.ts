// Explicit route-boundary guard for allowlisted routes (spec D2). Resolves
// the principal ONCE (recordUsage), runs the token guards of writeGuards.ts
// (connection perimeter, vDC confinement, live creator check) BEFORE the
// handler, forwards the principal via ctx, journals token writes, and stamps
// RateLimit-* on token responses.
import { headers } from "next/headers"

import { getPrincipal, rejectionToResponse, type Principal } from "@/lib/auth/principal"
import { getAllowlistEntryById, matchEntryParams } from "./allowlist"
import { auditTokenDenied, auditTokenWrite, runTokenEntryGuards } from "./writeGuards"

export type GuardedRouteContext = {
  params?: Promise<Record<string, string>> | Record<string, string>
  principal?: Principal
}

type GuardedHandler<C extends GuardedRouteContext> = (req: Request, ctx: C) => Promise<Response>

/**
 * Generic over the handler context so a wrapped export keeps the exact
 * `{ params }` type Next checks route handlers against.
 */
export function withPublicApiGuard<C extends GuardedRouteContext = GuardedRouteContext>(
  entryId: string,
  handler: GuardedHandler<C>,
): GuardedHandler<C & GuardedRouteContext> {
  return async (req, ctx) => {
    const result = await getPrincipal({ recordUsage: true })
    if (!result.ok) {
      await auditTokenDenied(result.rejection)
      return rejectionToResponse(result.rejection)
    }

    const principal = result.principal
    if (!principal || principal.kind !== "token") {
      // Session (or anonymous) caller: unchanged bit for bit, the handler's
      // own checkPermission does the work.
      return handler(req, ctx || ({} as C))
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

    // Params are re-derived from the same x-pxc-path getPrincipal verified,
    // never trusted from that earlier verification: a path that no longer
    // matches this entry fails closed.
    const params = matchEntryParams(entry, hdrs.get("x-pxc-path") || "")
    if (!params) return rejectionToResponse()

    const denied = await runTokenEntryGuards(entry, principal, req, params)
    if (denied) return denied

    let res: Response
    try {
      res = await handler(req, { ...(ctx || {}), principal } as C)
    } catch (err) {
      // A write that blew up mid-way may still have acted: journal it too.
      await auditTokenWrite(entry, principal, req, new Response(null, { status: 500 }))
      throw err
    }
    await auditTokenWrite(entry, principal, req, res)
    if (result.rateLimit) {
      res.headers.set("RateLimit-Limit", String(result.rateLimit.limit))
      res.headers.set("RateLimit-Remaining", String(result.rateLimit.remaining))
      res.headers.set("RateLimit-Reset", String(result.rateLimit.reset))
    }
    return res
  }
}
