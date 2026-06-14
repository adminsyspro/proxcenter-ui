import { NextResponse } from "next/server"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

/**
 * GET /api/v1/connections/[id]/ceph/flags
 *
 * Returns active Ceph OSD flags from the cluster.
 * PVE returns [{ name, description, value: bool }, ...] — we filter where value === true.
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

    const allFlags = await pveFetch<any[]>(conn, '/cluster/ceph/flags').catch(() => [])
    const activeFlags = (allFlags || [])
      .filter((f: any) => f.value === true || f.value === 1)
      .map((f: any) => f.name)

    return NextResponse.json({ data: { flags: activeFlags } })
  } catch (e: any) {
    console.error("[ceph/flags] GET Error:", e?.message)
    return NextResponse.json({ error: e?.message || "Failed to get Ceph flags" }, { status: 500 })
  }
}

/**
 * Set (value=true) or unset (value=false) a single Ceph OSD flag.
 *
 * PVE exposes `PUT /cluster/ceph/flags/{flag}` with a REQUIRED boolean `value`
 * parameter; there is no DELETE on the single-flag endpoint, so unsetting is
 * also a PUT with value=false. Params are form-encoded, per the PVE convention
 * used elsewhere in this codebase.
 *
 * Body (both PUT and DELETE): { flag: "noout" }
 */
async function setCephFlag(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
  value: boolean
) {
  const { id } = await ctx.params
  const body = await req.json().catch(() => ({}))
  const flag = body?.flag

  if (!flag || typeof flag !== 'string') {
    return NextResponse.json({ error: "Missing or invalid 'flag' parameter" }, { status: 400 })
  }

  const denied = await checkPermission(PERMISSIONS.NODE_MANAGE, "connection", id)
  if (denied) return denied

  const conn = await getConnectionById(id)
  if (!conn) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 })
  }

  await pveFetch(conn, `/cluster/ceph/flags/${encodeURIComponent(flag)}`, {
    method: 'PUT',
    body: new URLSearchParams({ value: value ? '1' : '0' }),
  })

  return NextResponse.json({ success: true, flag, value })
}

/**
 * PUT /api/v1/connections/[id]/ceph/flags — set a Ceph OSD flag. Body: { flag }
 */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    return await setCephFlag(req, ctx, true)
  } catch (e: any) {
    console.error("[ceph/flags] PUT Error:", String(e?.message).replace(/[\r\n]/g, ''))
    return NextResponse.json({ error: e?.message || "Failed to set Ceph flag" }, { status: 500 })
  }
}

/**
 * DELETE /api/v1/connections/[id]/ceph/flags — unset a Ceph OSD flag. Body: { flag }
 */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    return await setCephFlag(req, ctx, false)
  } catch (e: any) {
    console.error("[ceph/flags] DELETE Error:", String(e?.message).replace(/[\r\n]/g, ''))
    return NextResponse.json({ error: e?.message || "Failed to unset Ceph flag" }, { status: 500 })
  }
}
