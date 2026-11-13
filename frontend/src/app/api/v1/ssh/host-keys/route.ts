import { NextResponse } from "next/server"

import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { listHostKeys } from "@/lib/ssh/host-key-store"
import { hostKeyInScope, hostKeyScope } from "@/lib/ssh/hostKeyAccess"

export const runtime = "nodejs"

/** The bare host of a registry row ("host:port", or a legacy bare host). */
export function bareHost(host: string): string {
  const h = host.trim().toLowerCase()
  // A legacy row carries no port. An IPv6 literal carries several colons, so
  // only the last group of a "host:port" row is the port.
  const i = h.lastIndexOf(":")
  if (i < 0 || !/^\d{1,5}$/.test(h.slice(i + 1))) return h

  return h.slice(0, i)
}

// GET /api/v1/ssh/host-keys
//
// Every SSH host key ProxCenter and the orchestrator check, one row per
// endpoint and key type: the trusted key (confirmed by an operator, or pinned
// automatically before confirmation existed) and any key waiting for
// confirmation. The registry is installation-wide: each caller lists the hosts
// of its own connections.
export async function GET() {
  try {
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW)
    if (denied) return denied

    const scope = await hostKeyScope(PERMISSIONS.CONNECTION_VIEW)
    const keys = (await listHostKeys()).filter(k => hostKeyInScope(scope, bareHost(k.host)))

    return NextResponse.json({ keys })
  } catch (error: any) {
    console.error("Failed to list SSH host keys:", String(error?.message || "").replace(/[\r\n]/g, ""))

    return NextResponse.json({ error: "Failed to list SSH host keys" }, { status: 500 })
  }
}
