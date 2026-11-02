import { NextResponse } from "next/server"

import { licenseExcludedResponse } from "@/lib/api/response"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById, isConnectionNotFoundError } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { denyIaasTenantCeph } from "@/lib/ceph/tenantGuard"
import { assertNodeName } from "@/lib/ssh/validate"
import { pickOnlineNode } from "@/lib/ceph/nodeNoout"
import { clientOkToStopPayload } from "@/lib/ceph/okToStopClient"
import { runOkToStopApi } from "@/lib/ceph/okToStopApi"

export const runtime = "nodejs"

/*
   Read-only precheck of the cockpit OSD drawer: would marking this OSD out or
   stopping it take placement groups offline? Two PVE reads, no SSH:
   `/cluster/status` to pick an online node, then `GET /nodes/{node}/ceph/cmd-safety`
   (service=osd, action=stop) for the verdict.
   A verdict that cannot be obtained answers ok:false with a message.
*/

type Ctx = { params: Promise<{ id: string; node: string; osdid: string }> }

/** POST /api/v1/connections/[id]/nodes/[node]/ceph/osd/[osdid]/ok-to-stop -> { data: OkToStopPayload } */
export async function POST(_req: Request, ctx: Ctx) {
  try {
    const { id, node, osdid } = await ctx.params
    if (!/^\d+$/.test(osdid)) {
      return NextResponse.json({ error: "Invalid OSD id" }, { status: 400 })
    }
    let safeNode: string
    try {
      safeNode = assertNodeName(node)
    } catch {
      return NextResponse.json({ error: "Invalid node name" }, { status: 400 })
    }

    const denied = await checkPermission(PERMISSIONS.STORAGE_ADMIN, "connection", id)
    if (denied) return denied
    // Ceph is a whole-cluster object: an IaaS tenant gets 404, before any PVE call.
    const cephDenied = await denyIaasTenantCeph()
    if (cephDenied) return cephDenied

    const osd = Number(osdid)
    const conn = await getConnectionById(id)
    const clusterStatus = await pveFetch<any[]>(conn, "/cluster/status").catch(() => null)
    // Without the rows there is no membership check and the verdict is unknown.
    if (!Array.isArray(clusterStatus)) {
      return NextResponse.json({ data: { ok: false, osds: [osd], numOkPgs: 0, numNotOkPgs: 0, message: "Cluster status unreadable" } })
    }
    if (!clusterStatus.some(r => r?.type === "node" && r.name === safeNode)) {
      return NextResponse.json({ error: "Node not found in this connection" }, { status: 404 })
    }
    const viaNode = pickOnlineNode(clusterStatus, safeNode) ?? safeNode
    const check = await runOkToStopApi(conn, viaNode, osd, "ceph/osd")

    return NextResponse.json({ data: clientOkToStopPayload(check, [osd], "ceph/osd") })
  } catch (e: any) {
    const excluded = licenseExcludedResponse(e)
    if (excluded) return excluded
    if (isConnectionNotFoundError(e)) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }
    console.error("[ceph/osd] ok-to-stop Error:", String(e?.message).replace(/[\r\n]/g, ""))
    return NextResponse.json({ error: "Failed to check the OSD" }, { status: 500 })
  }
}
