import { NextResponse } from "next/server"

import { safeLog } from "@/lib/log/sanitize"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { forgetHostKey } from "@/lib/ssh/host-key-store"
import { hostKeyInScope, hostKeyScope } from "@/lib/ssh/hostKeyAccess"
import { withAudit } from "@/lib/audit/withAudit"

import { bareHost } from "../route"

export const runtime = "nodejs"

// DELETE /api/v1/ssh/host-keys/[host]
//
// Forget host keys: every port and key type of a bare host, or one endpoint
// when `host` is "host:port" as the registry lists it. The next connection is
// then refused until its key is confirmed again; nothing is re-pinned silently.
async function handleDelete(
  _req: Request,
  ctx: { params: Promise<{ host: string }> | { host: string } }
) {
  try {
    const denied = await checkPermission(PERMISSIONS.CONNECTION_MANAGE)
    if (denied) return denied

    const params = await Promise.resolve(ctx.params)
    const raw = (params as any)?.host
    const host = typeof raw === "string" ? raw.trim().toLowerCase() : ""

    if (!host || /[/\s]/.test(host)) {
      return NextResponse.json({ error: "Invalid host" }, { status: 400 })
    }

    // The registry is installation-wide: the caller only forgets the keys of a
    // host of a connection they manage, and an unknown host reads as unknown.
    if (!hostKeyInScope(await hostKeyScope(PERMISSIONS.CONNECTION_MANAGE), bareHost(host))) {
      return NextResponse.json({ error: `no host key for ${host}` }, { status: 404 })
    }

    const removed = await forgetHostKey(host)

    if (removed === 0) {
      return NextResponse.json({ error: `no host key for ${host}` }, { status: 404 })
    }

    console.log(`[ssh] forgot ${removed} host key(s) for ${safeLog(host)}`)

    return NextResponse.json({ status: "forgotten", host, removed })
  } catch (error: any) {
    console.error("Failed to forget SSH host key:", String(error?.message || "").replace(/[\r\n]/g, ""))

    return NextResponse.json({ error: "Failed to forget SSH host key" }, { status: 500 })
  }
}

export const DELETE = withAudit({ category: "security", resourceType: "host_key", resourceParam: "host" }, handleDelete)
