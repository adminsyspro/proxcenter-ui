import { NextResponse } from "next/server"
import { licenseExcludedResponse } from "@/lib/api/response"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById, isConnectionNotFoundError } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { denyIaasTenantCeph } from "@/lib/ceph/tenantGuard"
import { assertNodeName } from "@/lib/ssh/validate"
import { withAudit } from "@/lib/audit/withAudit"
import { pickOnlineNode, type OkToStopVerdict } from "@/lib/ceph/nodeNoout"
import { runOkToStopApi } from "@/lib/ceph/okToStopApi"
import { clientOkToStopPayload, OK_TO_STOP_UNAVAILABLE } from "@/lib/ceph/okToStopClient"
import { isCephServiceAction, osdIdOf, parseCephService } from "@/lib/ceph/service"

export const runtime = "nodejs"

/*
   Start, stop or restart one Ceph daemon from the node Ceph tab (ui#1164).

   PVE exposes `POST /nodes/{node}/ceph/{start|stop|restart}` with the service
   name (`osd.2`, `mon.pve1`, `mgr.pve1`, `mds.pve1`; the whole-node targets
   PVE also knows are refused here); the call must reach the node that hosts
   the daemon, which is the `[node]` of this URL. Stopping or restarting an OSD first asks Ceph whether
   that is safe (PVE `GET /nodes/{node}/ceph/cmd-safety`, no SSH): when
   placement groups would go offline the answer is 409 `not_ok_to_stop` and
   nothing happens, unless the body says `force: true`.
*/

type Ctx = { params: Promise<{ id: string; node: string }> }

/** The 409 text: the PG count only when Ceph gave one, a fixed text when no verdict could be obtained. */
function refusalText(serviceName: string, verdict: OkToStopVerdict | null): string {
  if (!verdict) return OK_TO_STOP_UNAVAILABLE
  if (verdict.numNotOkPgs > 0) return `Stopping ${serviceName} would take ${verdict.numNotOkPgs} PG(s) offline`
  return `Stopping ${serviceName} is not safe right now`
}

function serviceError(e: any): NextResponse {
  const excluded = licenseExcludedResponse(e)
  if (excluded) return excluded
  console.error("[ceph/service] POST Error:", String(e?.message).replace(/[\r\n]/g, ""))
  if (isConnectionNotFoundError(e)) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 })
  }
  return NextResponse.json({ error: e?.message || "Failed to act on the Ceph service" }, { status: 500 })
}

/**
 * POST /api/v1/connections/[id]/nodes/[node]/ceph/service
 * Body: { action: 'start' | 'stop' | 'restart', service: string, force?: boolean }
 * Answers { data: { upid, node, service, action, forced } }.
 */
async function handlePost(req: Request, ctx: Ctx) {
  try {
    const { id, node } = await ctx.params
    let safeNode: string
    try {
      safeNode = assertNodeName(node)
    } catch {
      return NextResponse.json({ error: "Invalid node name" }, { status: 400 })
    }

    // Like the OSD flags: a daemon of the cluster's storage, a storage.admin action.
    const denied = await checkPermission(PERMISSIONS.STORAGE_ADMIN, "connection", id)
    if (denied) return denied
    // Ceph is a whole-cluster object: an IaaS tenant gets 404, before any PVE call.
    const cephDenied = await denyIaasTenantCeph()
    if (cephDenied) return cephDenied

    const body = await req.json().catch(() => ({}))
    const action = body?.action
    if (!isCephServiceAction(action)) {
      return NextResponse.json({ error: "action must be start, stop or restart" }, { status: 400 })
    }
    const service = parseCephService(body?.service)
    if (!service) {
      return NextResponse.json({ error: "Invalid service name: expected mon.<id>, mgr.<id>, mds.<id> or osd.<n>" }, { status: 400 })
    }
    const serviceName = body.service as string
    const force = body?.force === true

    const conn = await getConnectionById(id)

    const osdId = osdIdOf(service)
    if (action !== "start" && osdId !== null && !force) {
      const clusterStatus = await pveFetch<any[]>(conn, "/cluster/status").catch(() => null)
      const viaNode = pickOnlineNode(clusterStatus, safeNode) ?? safeNode
      const check = await runOkToStopApi(conn, viaNode, osdId, "ceph/service")
      if (!check.verdict?.ok) {
        return NextResponse.json({
          error: refusalText(serviceName, check.verdict),
          code: "not_ok_to_stop",
          okToStop: clientOkToStopPayload(check, [osdId], "ceph/service"),
        }, { status: 409 })
      }
    }

    const upid = await pveFetch<string>(conn, `/nodes/${encodeURIComponent(safeNode)}/ceph/${action}`, {
      method: "POST",
      body: new URLSearchParams({ service: serviceName }),
    })
    return NextResponse.json({ data: { upid, node: safeNode, service: serviceName, action, forced: force } })
  } catch (e: any) {
    return serviceError(e)
  }
}

export const POST = withAudit({ category: "nodes", resourceType: "node", resourceParam: "node", action: "ceph_service" }, handlePost)
