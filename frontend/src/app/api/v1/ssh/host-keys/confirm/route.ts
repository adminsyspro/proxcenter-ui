import { NextResponse } from "next/server"

import { getPrincipal } from "@/lib/auth/principal"
import { safeLog } from "@/lib/log/sanitize"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { confirmHostKey, hostKeyEndpoint } from "@/lib/ssh/host-key-store"
import { hostKeyInScope, hostKeyScope } from "@/lib/ssh/hostKeyAccess"
import { withAudit } from "@/lib/audit/withAudit"

import { bareHost } from "../route"

export const runtime = "nodejs"

const FINGERPRINT = /^SHA256:[A-Za-z0-9+/]{43}$/

// POST /api/v1/ssh/host-keys/confirm  { host: "host:port", fingerprint: "SHA256:..." }
//
// An operator trusts the host key they were shown: the key of the endpoint
// with exactly that fingerprint becomes the trusted one. A key that changed
// since it was shown is not confirmed (404), so the operator never trusts a
// key they did not see. Session users only: an API token does not take a
// trust decision.
async function handlePost(req: Request) {
  try {
    const denied = await checkPermission(PERMISSIONS.CONNECTION_MANAGE)
    if (denied) return denied

    const principal = await getPrincipal()
    if (!principal.ok || principal.principal?.kind !== "session" || !principal.principal.userEmail) {
      return NextResponse.json({ error: "Host keys are confirmed from a signed-in session" }, { status: 403 })
    }

    const body = await req.json().catch(() => null)
    const rawHost = typeof body?.host === "string" ? body.host.trim().toLowerCase() : ""
    const fingerprint = typeof body?.fingerprint === "string" ? body.fingerprint.trim() : ""
    const i = rawHost.lastIndexOf(":")
    const port = i > 0 ? Number(rawHost.slice(i + 1)) : NaN

    if (!rawHost || /[/\s]/.test(rawHost) || !Number.isInteger(port) || port < 1 || port > 65535 || !FINGERPRINT.test(fingerprint)) {
      return NextResponse.json({ error: "Expected host as host:port and a SHA256 fingerprint" }, { status: 400 })
    }
    const host = bareHost(rawHost)

    if (!hostKeyInScope(await hostKeyScope(PERMISSIONS.CONNECTION_MANAGE), host)) {
      return NextResponse.json({ error: `no host key for ${rawHost}` }, { status: 404 })
    }

    const endpoint = hostKeyEndpoint(host, port)
    if (!(await confirmHostKey(endpoint, fingerprint, principal.principal.userEmail))) {
      return NextResponse.json(
        { error: `${endpoint} has no key with fingerprint ${fingerprint}: test the connection again` },
        { status: 404 }
      )
    }

    console.log(`[ssh] host key ${safeLog(fingerprint)} of ${safeLog(endpoint)} confirmed by ${safeLog(principal.principal.userEmail)}`)

    return NextResponse.json({ status: "confirmed", host: endpoint, fingerprint })
  } catch (error: any) {
    console.error("Failed to confirm SSH host key:", String(error?.message || "").replace(/[\r\n]/g, ""))

    return NextResponse.json({ error: "Failed to confirm SSH host key" }, { status: 500 })
  }
}

export const POST = withAudit({ category: "security", resourceType: "host_key", resourceBodyField: "host" }, handlePost)
