import { NextResponse } from "next/server"

import { licenseExcludedResponse } from "@/lib/api/response"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById, isConnectionNotFoundError } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { denyIaasTenantCeph } from "@/lib/ceph/tenantGuard"
import { isCephAbsentError } from "@/lib/ceph/cephAbsent"
import { parseCrushMap } from "@/lib/ceph/crushRules"
import { pickOnlineNode } from "@/lib/ceph/nodeNoout"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/*
   CRUSH map of the cluster, parsed: buckets, rules and types. Two PVE calls:
   `/cluster/status` to pick an online node (a down node would time out), then
   the decompiled map from that node.
*/

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params

    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW, "connection", id)
    if (denied) return denied
    // Ceph is a whole-cluster object: an IaaS tenant gets 404, before any PVE call.
    const cephDenied = await denyIaasTenantCeph()
    if (cephDenied) return cephDenied

    const conn = await getConnectionById(id)
    const clusterStatus = await pveFetch<any[]>(conn, "/cluster/status")
    const node = pickOnlineNode(clusterStatus, "")
    if (!node) return NextResponse.json({ error: "No online node found" }, { status: 404 })

    const text = await pveFetch<string>(conn, `/nodes/${encodeURIComponent(node)}/ceph/crush`)

    return NextResponse.json({ data: parseCrushMap(typeof text === "string" ? text : "") })
  } catch (e: any) {
    const excluded = licenseExcludedResponse(e)
    if (excluded) return excluded
    if (isConnectionNotFoundError(e)) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }
    if (isCephAbsentError(e)) {
      return NextResponse.json({ error: "Ceph not available on this cluster", hasCeph: false }, { status: 404 })
    }
    console.error("[ceph/crush] GET Error:", String(e?.message).replace(/[\r\n]/g, ""))
    return NextResponse.json({ error: "Failed to read the CRUSH map" }, { status: 500 })
  }
}
