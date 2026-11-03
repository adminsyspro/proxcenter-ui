// src/lib/connections/providerPveRead.ts
//
// The GET handler shared by the routes that relay one Proxmox read of the
// cluster or of a node as a whole (datacenter firewall, node hardware, metric
// servers, notification matchers...). Same steps, in the same order, for all
// of them: the IaaS tenant gate (lib/tenant/iaasGuard) before anything else,
// the permission on the connection or on the node, then the read itself.

import { NextResponse } from "next/server"

import { getConnectionById } from "@/lib/connections/getConnection"
import { pveFetch } from "@/lib/proxmox/client"
import { buildNodeResourceId, checkPermission } from "@/lib/rbac"
import { denyIaasTenant } from "@/lib/tenant/iaasGuard"

type RouteParams = Record<string, string | undefined>
type RouteContext = { params: Promise<RouteParams> | RouteParams }

export interface ProviderPveReadOptions {
  /** Permission checked before the read. */
  permission: string
  /** Checked on the connection, or on the route's node (`[node]` segment). */
  on: "connection" | "node"
  /** Proxmox path to read, from the route params. */
  path: (params: RouteParams) => string
  /** A list answers [] when Proxmox returns no array, an object answers {} when it returns nothing. */
  shape: "list" | "object"
}

export function providerPveRead(opts: ProviderPveReadOptions) {
  return async function GET(_req: Request, ctx: RouteContext): Promise<NextResponse> {
    const iaasDenied = await denyIaasTenant()
    if (iaasDenied) return iaasDenied

    try {
      const params = await Promise.resolve(ctx.params)
      const id = params?.id

      if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

      const denied = opts.on === "node"
        ? await checkPermission(opts.permission, "node", buildNodeResourceId(id, String(params.node)))
        : await checkPermission(opts.permission, "connection", id)
      if (denied) return denied

      const conn = await getConnectionById(id)
      const data = await pveFetch<unknown>(conn, opts.path(params))

      if (opts.shape === "list") return NextResponse.json({ data: Array.isArray(data) ? data : [] })

      return NextResponse.json({ data: data ?? {} })
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
    }
  }
}
