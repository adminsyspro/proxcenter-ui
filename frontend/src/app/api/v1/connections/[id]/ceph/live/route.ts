import { NextResponse } from "next/server"

import { licenseExcludedResponse } from "@/lib/api/response"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById, isConnectionNotFoundError } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { denyIaasTenantCeph } from "@/lib/ceph/tenantGuard"
import { isCephAbsentError } from "@/lib/ceph/cephAbsent"
import { liveFromCephStatus } from "@/lib/ceph/live"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/*
   Light Ceph read for the cockpit Live strip: ONE PVE call, the cluster-wide
   `/cluster/ceph/status`, reduced to a CephLive. The raw status weighs about
   180 KB (the mgrmap alone is ~195 KB of JSON), so it never leaves this route.
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
    const status = await pveFetch<unknown>(conn, "/cluster/ceph/status")

    return NextResponse.json({ data: liveFromCephStatus(status, Date.now()) })
  } catch (e: any) {
    const excluded = licenseExcludedResponse(e)
    if (excluded) return excluded
    if (isConnectionNotFoundError(e)) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }
    if (isCephAbsentError(e)) {
      return NextResponse.json({ error: "Ceph not available on this cluster", hasCeph: false }, { status: 404 })
    }
    console.error("[ceph/live] GET Error:", String(e?.message).replace(/[\r\n]/g, ""))
    return NextResponse.json({ error: "Failed to read the Ceph status" }, { status: 500 })
  }
}
