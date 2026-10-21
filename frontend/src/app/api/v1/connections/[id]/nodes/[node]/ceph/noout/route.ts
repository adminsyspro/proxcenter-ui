import { NextResponse } from "next/server"
import { licenseExcludedResponse } from "@/lib/api/response"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById, isConnectionNotFoundError } from "@/lib/connections/getConnection"
import { checkPermission, buildNodeResourceId, PERMISSIONS } from "@/lib/rbac"
import { executeSSH } from "@/lib/ssh/exec"
import { assertNodeName } from "@/lib/ssh/validate"
import { safeLog } from "@/lib/log/sanitize"
import { formatSshEndpoint, resolveNodeSshEndpoint } from "@/lib/ssh/node-endpoint"
import { withAudit } from "@/lib/audit/withAudit"
import {
  crushHostMatchesNode,
  findNodeOsds,
  groupFlagCommand,
  hostFlagsOf,
  parseOsdFlagsDetail,
  pickOnlineNode,
  summarizeCephHealth,
  type CephHealthSummary,
  type NodeOsd,
} from "@/lib/ceph/nodeNoout"
import { okToStopPayload, runOkToStop as runOkToStopOver, type OkToStopResult } from "@/lib/ceph/okToStopSsh"

export const runtime = "nodejs"

/*
   Per-host Ceph noout of one node (ui#1164).

   A node entering maintenance should not have Ceph re-replicate the data of
   its OSDs while it is away: `ceph osd set-group noout <crush host>` keeps
   them "in" without silencing the whole cluster, and `unset-group` lifts it
   when the node is back. Neither command exists in the PVE API, nor does
   `ceph osd ok-to-stop`, the precheck that says whether stopping the OSDs
   would take PGs offline: all three run over SSH. Reading is pure PVE API:
   the OSD tree names the CRUSH host of the node and its OSDs, and the health
   detail of /cluster/ceph/status lists the per-host flags.
*/

type Ctx = { params: Promise<{ id: string; node: string }> }

interface NodeCeph {
  hasCeph: boolean
  crushHost: string | null
  osds: NodeOsd[]
  /** The host flag noout is set on this node's CRUSH host. */
  noout: boolean
  /** Every flag set on this node's CRUSH host (noout, noin, noup, nodown). */
  hostFlags: string[]
  /** The cluster-wide noout flag is set (the one of /cluster/ceph/flags). */
  globalNoout: boolean
  health: CephHealthSummary | null
  otherHostsWithNoout: string[]
  /** Online node the Ceph commands run on: the node itself while it is up. */
  viaNode: string
}

const NO_CEPH: Omit<NodeCeph, "viaNode"> = {
  hasCeph: false, crushHost: null, osds: [], noout: false, hostFlags: [], globalNoout: false, health: null, otherHostsWithNoout: [],
}

// Same mapping as the maintenance route: a cluster outside the license
// answers 403 with its code, a not-found 404, anything else 500.
function nooutError(label: string, e: any, fallback: string): NextResponse {
  const excluded = licenseExcludedResponse(e)
  if (excluded) return excluded
  console.error(`[ceph/noout] ${label} Error:`, e?.message)
  if (isConnectionNotFoundError(e)) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 })
  }
  return NextResponse.json({ error: e?.message || fallback }, { status: 500 })
}

/**
 * What Ceph knows about the node. The OSD tree is read through an online
 * node (the OSD tree is cluster-wide) so the state stays readable, and the
 * flag removable, while the node itself is still down. A PVE error on the
 * tree means Ceph is not installed there.
 */
async function loadNodeCeph(conn: any, node: string): Promise<NodeCeph> {
  const clusterStatus = await pveFetch<any[]>(conn, "/cluster/status").catch(() => null)
  const viaNode = pickOnlineNode(clusterStatus, node) ?? node

  let tree: unknown
  try {
    tree = await pveFetch<unknown>(conn, `/nodes/${encodeURIComponent(viaNode)}/ceph/osd`)
  } catch {
    return { ...NO_CEPH, viaNode }
  }
  const { crushHost, osds, globalFlags } = findNodeOsds(tree, node)

  const status = await pveFetch<any>(conn, "/cluster/ceph/status").catch(() => null)
  const health = status?.health ?? null
  const detail = parseOsdFlagsDetail(health)
  const otherHostsWithNoout = Object.entries(detail.hosts)
    .filter(([host, flags]) => flags.includes("noout") && !(crushHost && crushHostMatchesNode(host, crushHost)))
    .map(([host]) => host)

  const hostFlags = hostFlagsOf(detail, crushHost)

  return {
    hasCeph: true,
    crushHost,
    osds,
    noout: hostFlags.includes("noout"),
    hostFlags,
    globalNoout: globalFlags.includes("noout"),
    health: health ? summarizeCephHealth(health) : null,
    otherHostsWithNoout,
    viaNode,
  }
}

/** `ceph osd ok-to-stop` on the node's OSDs, through the shared SSH runner. */
function runOkToStop(connId: string, conn: any, ceph: NodeCeph): Promise<OkToStopResult> {
  return runOkToStopOver(connId, conn, ceph.viaNode, ceph.osds.map(o => o.id), "ceph/noout")
}

function okToStopView(result: OkToStopResult, ceph: NodeCeph) {
  return okToStopPayload(result, ceph.osds.map(o => o.id))
}

function publicView(ceph: NodeCeph) {
  const { viaNode: _viaNode, ...view } = ceph
  return view
}

/**
 * GET /api/v1/connections/[id]/nodes/[node]/ceph/noout
 *
 * The node's CRUSH host, OSDs, host flag, the global flag, the cluster health
 * and the other hosts flagged noout. `?precheck=1` adds the ok-to-stop
 * verdict for the node's OSDs (one SSH command). `{ hasCeph: false }` when
 * Ceph is not installed; no CRUSH host or no OSD when the node hosts none.
 */
export async function GET(req: Request, ctx: Ctx) {
  try {
    const { id, node } = await ctx.params
    let safeNode: string
    try {
      safeNode = assertNodeName(node)
    } catch {
      return NextResponse.json({ error: "Invalid node name" }, { status: 400 })
    }

    const denied = await checkPermission(PERMISSIONS.NODE_VIEW, "node", buildNodeResourceId(id, safeNode))
    if (denied) return denied

    const conn = await getConnectionById(id)
    const ceph = await loadNodeCeph(conn, safeNode)
    const data: Record<string, unknown> = publicView(ceph)

    const precheck = new URL(req.url).searchParams.get("precheck") === "1"
    if (precheck && ceph.hasCeph && ceph.osds.length > 0) {
      data.okToStop = okToStopView(await runOkToStop(id, conn, ceph), ceph)
    }
    return NextResponse.json({ data })
  } catch (e: any) {
    return nooutError("GET", e, "Failed to read the Ceph noout state")
  }
}

/**
 * The part POST and DELETE share: node name, permission, connection, the
 * Ceph view and the command for the node's CRUSH host. Returns a response
 * when something stops the handler there.
 */
async function prepareWrite(ctx: Ctx, enable: boolean): Promise<
  | { response: NextResponse }
  | { id: string; conn: any; ceph: NodeCeph; command: string }
> {
  const { id, node } = await ctx.params
  let safeNode: string
  try {
    safeNode = assertNodeName(node)
  } catch {
    return { response: NextResponse.json({ error: "Invalid node name" }, { status: 400 }) }
  }

  const denied = await checkPermission(PERMISSIONS.NODE_MANAGE, "node", buildNodeResourceId(id, safeNode))
  if (denied) return { response: denied }

  const conn = await getConnectionById(id)
  const ceph = await loadNodeCeph(conn, safeNode)
  if (!ceph.hasCeph || !ceph.crushHost || (enable && ceph.osds.length === 0)) {
    return { response: NextResponse.json({ error: "This node hosts no Ceph OSD", code: "no_osds" }, { status: 409 }) }
  }

  // The CRUSH host comes from Ceph, not from the URL, and still goes through
  // the hostname grammar before it reaches a shell.
  let command: string
  try {
    command = groupFlagCommand("noout", ceph.crushHost, enable)
  } catch {
    return { response: NextResponse.json({ error: "Invalid CRUSH host name" }, { status: 400 }) }
  }
  return { id, conn, ceph, command }
}

async function runGroupCommand(id: string, conn: any, ceph: NodeCeph, command: string, extra: Record<string, unknown>) {
  const endpoint = await resolveNodeSshEndpoint(conn, ceph.viaNode)
  console.log(`[ceph/noout] executing via SSH on ${safeLog(formatSshEndpoint(endpoint))}: ${safeLog(command)}`)
  const result = await executeSSH(id, endpoint, command)
  if (result.success) {
    return NextResponse.json({ success: true, crushHost: ceph.crushHost, osds: ceph.osds.map(o => o.id), output: result.output, ...extra })
  }
  return NextResponse.json({ error: result.error, hint: `Run manually on a PVE node: ${command}` }, { status: 500 })
}

/**
 * POST /api/v1/connections/[id]/nodes/[node]/ceph/noout
 *
 * Set noout on the node's CRUSH host. The ok-to-stop precheck runs again
 * first: when stopping the OSDs would take PGs offline the answer is 409
 * `not_ok_to_stop` and nothing is set, unless the body says `force: true`.
 */
async function handlePost(req: Request, ctx: Ctx) {
  try {
    const prepared = await prepareWrite(ctx, true)
    if ("response" in prepared) return prepared.response
    const { id, conn, ceph, command } = prepared

    const body = await req.json().catch(() => ({}))
    const force = body?.force === true
    if (!force) {
      const check = await runOkToStop(id, conn, ceph)
      if (!check.verdict?.ok) {
        return NextResponse.json({
          error: check.error || `Stopping the OSDs of this node would take ${check.verdict?.numNotOkPgs ?? 0} PG(s) offline`,
          code: "not_ok_to_stop",
          okToStop: okToStopView(check, ceph),
        }, { status: 409 })
      }
    }
    return await runGroupCommand(id, conn, ceph, command, { forced: force })
  } catch (e: any) {
    return nooutError("POST", e, "Failed to set the Ceph noout flag")
  }
}

/**
 * DELETE /api/v1/connections/[id]/nodes/[node]/ceph/noout
 *
 * Unset noout on the node's CRUSH host. While one of the node's OSDs is not
 * up yet the flag is kept and the answer is 409 `osds_down` with their ids,
 * unless `?force=1`: lifting it then would let Ceph mark them out.
 */
async function handleDelete(req: Request, ctx: Ctx) {
  try {
    const prepared = await prepareWrite(ctx, false)
    if ("response" in prepared) return prepared.response
    const { id, conn, ceph, command } = prepared

    const force = new URL(req.url).searchParams.get("force") === "1"
    const down = ceph.osds.filter(o => o.status !== "up").map(o => o.id)
    if (!force && down.length > 0) {
      return NextResponse.json({
        error: `OSD(s) ${down.map(i => `osd.${i}`).join(", ")} of this node are not up yet: noout kept`,
        code: "osds_down",
        osds: down,
      }, { status: 409 })
    }
    return await runGroupCommand(id, conn, ceph, command, { forced: force, osdsDown: down })
  } catch (e: any) {
    return nooutError("DELETE", e, "Failed to remove the Ceph noout flag")
  }
}

export const POST = withAudit({ category: "nodes", resourceType: "node", resourceParam: "node", action: "ceph_noout" }, handlePost)
export const DELETE = withAudit({ category: "nodes", resourceType: "node", resourceParam: "node", action: "ceph_noout" }, handleDelete)
