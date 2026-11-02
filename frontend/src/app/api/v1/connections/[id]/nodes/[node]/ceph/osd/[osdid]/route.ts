import { NextResponse } from "next/server"

import { licenseExcludedResponse } from "@/lib/api/response"
import { audit } from "@/lib/audit"
import { withAudit } from "@/lib/audit/withAudit"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById, isConnectionNotFoundError } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { denyIaasTenantCeph } from "@/lib/ceph/tenantGuard"
import { assertNodeName } from "@/lib/ssh/validate"
import { pickOnlineNode } from "@/lib/ceph/nodeNoout"
import { runOkToStopApi } from "@/lib/ceph/okToStopApi"
import { clientOkToStopPayload, OK_TO_STOP_UNAVAILABLE } from "@/lib/ceph/okToStopClient"

export const runtime = "nodejs"

/*
   Act on one OSD from the Ceph cockpit: in, out, scrub or deep-scrub, through
   PVE `POST /nodes/{node}/ceph/osd/{id}/{in|out|scrub}` (deep-scrub is scrub
   with `deep=1`). Marking an OSD out first asks Ceph whether that is safe
   (PVE `GET /nodes/{node}/ceph/cmd-safety`, no SSH): when placement groups would go offline
   the answer is 409 `not_ok_to_stop` and nothing happens, unless the body
   says `force: true`.
*/

type Ctx = { params: Promise<{ id: string; node: string; osdid: string }> }

const ACTIONS = ["in", "out", "scrub", "deep-scrub"] as const
type OsdAction = (typeof ACTIONS)[number]

function isOsdAction(value: unknown): value is OsdAction {
  return typeof value === "string" && (ACTIONS as readonly string[]).includes(value)
}

async function auditSafely(entry: Parameters<typeof audit>[0]): Promise<void> {
  try {
    await audit(entry)
  } catch (err) {
    console.error("[ceph/osd] audit row lost:", String((err as Error)?.message).replace(/[\r\n]/g, ""))
  }
}

function osdError(e: any): NextResponse {
  const excluded = licenseExcludedResponse(e)
  if (excluded) return excluded
  console.error("[ceph/osd] POST Error:", String(e?.message).replace(/[\r\n]/g, ""))
  if (isConnectionNotFoundError(e)) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 })
  }
  return NextResponse.json({ error: "Failed to act on the OSD" }, { status: 500 })
}

/**
 * POST /api/v1/connections/[id]/nodes/[node]/ceph/osd/[osdid]
 * Body: { action: 'in' | 'out' | 'scrub' | 'deep-scrub', force?: boolean }
 * Answers { data: { upid, node, osd, action } }.
 */
async function handlePost(req: Request, ctx: Ctx) {
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

    const body = await req.json().catch(() => ({}))
    const action = body?.action
    if (!isOsdAction(action)) {
      return NextResponse.json({ error: "action must be in, out, scrub or deep-scrub" }, { status: 400 })
    }
    const force = body?.force === true
    const osd = Number(osdid)

    const conn = await getConnectionById(id)

    const nodes = await pveFetch<any[]>(conn, "/nodes")
    if (!Array.isArray(nodes) || !nodes.some(n => n?.node === safeNode)) {
      return NextResponse.json({ error: "Node not found in this connection" }, { status: 404 })
    }

    if (action === "out" && !force) {
      const clusterStatus = await pveFetch<any[]>(conn, "/cluster/status").catch(() => null)
      const viaNode = pickOnlineNode(clusterStatus, safeNode) ?? safeNode
      const check = await runOkToStopApi(conn, viaNode, osd, "ceph/osd")
      if (!check.verdict?.ok) {
        const okToStop = clientOkToStopPayload(check, [osd], "ceph/osd")
        await auditSafely({
          category: "nodes",
          action: "ceph_osd",
          resourceType: "node",
          resourceId: safeNode,
          status: "failure",
          errorMessage: "not_ok_to_stop",
          details: { detail: "ceph_osd_out", osd, okToStop },
        })
        return NextResponse.json({
          error: check.verdict ? `Marking osd.${osd} out would take ${check.verdict?.numNotOkPgs ?? 0} PG(s) offline` : OK_TO_STOP_UNAVAILABLE,
          code: "not_ok_to_stop",
          okToStop,
        }, { status: 409 })
      }
    }

    const base = `/nodes/${encodeURIComponent(safeNode)}/ceph/osd/${osd}`
    const upid = action === "in" || action === "out"
      ? await pveFetch<string>(conn, `${base}/${action}`, { method: "POST" })
      : await pveFetch<string>(conn, `${base}/scrub`, {
        method: "POST",
        ...(action === "deep-scrub" ? { body: new URLSearchParams({ deep: "1" }) } : {}),
      })

    // The wrapper's action is fixed; the row of a success names the verb.
    // The OSD has moved already: a lost audit row must not turn into a 500.
    await auditSafely({
      category: "nodes",
      action: "ceph_osd",
      resourceType: "node",
      resourceId: safeNode,
      details: { detail: `ceph_osd_${action.replace("-", "_")}`, osd, action, forced: action === "out" && force, upid: upid ?? null },
    })

    return NextResponse.json({ data: { upid: upid ?? null, node: safeNode, osd, action } })
  } catch (e: any) {
    return osdError(e)
  }
}

export const POST = withAudit({ category: "nodes", resourceType: "node", resourceParam: "node", action: "ceph_osd" }, handlePost)
