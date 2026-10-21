import { NextResponse } from "next/server"
import { licenseExcludedResponse } from "@/lib/api/response"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { withAudit } from "@/lib/audit/withAudit"
import { executeSSH } from "@/lib/ssh/exec"
import { assertNodeName } from "@/lib/ssh/validate"
import { safeLog } from "@/lib/log/sanitize"
import { formatSshEndpoint, resolveNodeSshEndpoint } from "@/lib/ssh/node-endpoint"
import { groupFlagCommand, isCephGroupFlag, parseOsdFlagsDetail, pickOnlineNode } from "@/lib/ceph/nodeNoout"

export const runtime = "nodejs"

/**
 * GET /api/v1/connections/[id]/ceph/flags
 *
 * Returns active Ceph OSD flags from the cluster.
 * PVE returns [{ name, description, value: bool }, ...] — we filter where value === true.
 * `hostFlags` adds the per-CRUSH-host flags (`ceph osd set-group`, ui#1164),
 * read from the OSD_FLAGS detail of the Ceph health: { pve3: ['noout'] };
 * `osdFlags` the ones set on a single OSD: { 'osd.4': ['noout'] }.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params

    const denied = await checkPermission(PERMISSIONS.NODE_VIEW, "connection", id)
    if (denied) return denied

    const conn = await getConnectionById(id)
    if (!conn) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    const [allFlags, status] = await Promise.all([
      pveFetch<any[]>(conn, '/cluster/ceph/flags').catch(() => []),
      pveFetch<any>(conn, '/cluster/ceph/status').catch(() => null),
    ])
    const activeFlags = (allFlags || [])
      .filter((f: any) => f.value === true || f.value === 1)
      .map((f: any) => f.name)
    const scoped = parseOsdFlagsDetail(status?.health)

    return NextResponse.json({ data: { flags: activeFlags, hostFlags: scoped.hosts, osdFlags: scoped.osds } })
  } catch (e: any) {
    console.error("[ceph/flags] GET Error:", e?.message)
    return NextResponse.json({ error: e?.message || "Failed to get Ceph flags" }, { status: 500 })
  }
}

/**
 * Set or unset a flag on one CRUSH host: `ceph osd set-group` / `unset-group`
 * (ui#1164). Not in the PVE API, so over SSH on an online node of the cluster;
 * only the four group flags exist, and the host is held to the hostname
 * grammar before it reaches a shell.
 */
async function setHostFlag(id: string, conn: any, flag: string, host: unknown, value: boolean) {
  if (!isCephGroupFlag(flag)) {
    return NextResponse.json({ error: "Only noup, nodown, noin and noout can be set on a host" }, { status: 400 })
  }
  let safeHost: string
  try {
    safeHost = assertNodeName(host)
  } catch {
    return NextResponse.json({ error: "Invalid host name" }, { status: 400 })
  }

  const clusterStatus = await pveFetch<any[]>(conn, '/cluster/status').catch(() => null)
  const viaNode = pickOnlineNode(clusterStatus, safeHost) ?? safeHost
  const endpoint = await resolveNodeSshEndpoint(conn, viaNode)
  const command = groupFlagCommand(flag, safeHost, value)
  console.log(`[ceph/flags] executing via SSH on ${safeLog(formatSshEndpoint(endpoint))}: ${safeLog(command)}`)
  const result = await executeSSH(id, endpoint, command)
  if (!result.success) {
    return NextResponse.json({ error: result.error, hint: `Run manually on a PVE node: ${command}` }, { status: 500 })
  }
  return NextResponse.json({ success: true, flag, host: safeHost, value })
}

/**
 * Set (value=true) or unset (value=false) a single Ceph OSD flag.
 *
 * PVE exposes `PUT /cluster/ceph/flags/{flag}` with a REQUIRED boolean `value`
 * parameter; there is no DELETE on the single-flag endpoint, so unsetting is
 * also a PUT with value=false. Params are form-encoded, per the PVE convention
 * used elsewhere in this codebase.
 *
 * Body (both PUT and DELETE): { flag: "noout" }, or { flag, host } for the
 * flag of one CRUSH host.
 */
async function setCephFlag(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
  value: boolean
) {
  const { id } = await ctx.params

  // OSD flags act on the whole Ceph cluster: a storage.admin action (#920).
  const denied = await checkPermission(PERMISSIONS.STORAGE_ADMIN, "connection", id)
  if (denied) return denied

  const body = await req.json().catch(() => ({}))
  const flag = body?.flag

  if (!flag || typeof flag !== 'string') {
    return NextResponse.json({ error: "Missing or invalid 'flag' parameter" }, { status: 400 })
  }

  const conn = await getConnectionById(id)
  if (!conn) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 })
  }

  if (body?.host !== undefined && body?.host !== null && body?.host !== '') {
    return setHostFlag(id, conn, flag, body.host, value)
  }

  await pveFetch(conn, `/cluster/ceph/flags/${encodeURIComponent(flag)}`, {
    method: 'PUT',
    body: new URLSearchParams({ value: value ? '1' : '0' }),
  })

  return NextResponse.json({ success: true, flag, value })
}

function flagError(label: string, e: any, fallback: string) {
  const excluded = licenseExcludedResponse(e)
  if (excluded) return excluded
  console.error(`[ceph/flags] ${label} Error:`, String(e?.message).replace(/[\r\n]/g, ''))
  return NextResponse.json({ error: e?.message || fallback }, { status: 500 })
}

/**
 * PUT /api/v1/connections/[id]/ceph/flags — set a Ceph OSD flag. Body: { flag, host? }
 */
async function handlePut(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    return await setCephFlag(req, ctx, true)
  } catch (e: any) {
    return flagError("PUT", e, "Failed to set Ceph flag")
  }
}

/**
 * DELETE /api/v1/connections/[id]/ceph/flags — unset a Ceph OSD flag. Body: { flag, host? }
 */
async function handleDelete(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    return await setCephFlag(req, ctx, false)
  } catch (e: any) {
    return flagError("DELETE", e, "Failed to unset Ceph flag")
  }
}

export const PUT = withAudit({ category: "cluster", resourceType: "ceph_flag", resourceParam: "id" }, handlePut)
export const DELETE = withAudit({ category: "cluster", resourceType: "ceph_flag", resourceParam: "id" }, handleDelete)
