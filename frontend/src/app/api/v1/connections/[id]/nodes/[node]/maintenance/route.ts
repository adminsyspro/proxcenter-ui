import { NextResponse } from "next/server"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildNodeResourceId, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

/**
 * GET /api/v1/connections/[id]/nodes/[node]/maintenance
 *
 * Returns current maintenance status by checking both node config
 * and cluster resources hastate (HA maintenance)
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; node: string }> }
) {
  try {
    const { id, node } = await ctx.params

    const resourceId = buildNodeResourceId(id, node)
    const denied = await checkPermission(PERMISSIONS.NODE_VIEW, "node", resourceId)
    if (denied) return denied

    const conn = await getConnectionById(id)
    if (!conn) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    const [config, nodeResources] = await Promise.all([
      pveFetch<any>(conn, `/nodes/${encodeURIComponent(node)}/config`, { method: 'GET' }).catch(() => null),
      pveFetch<any[]>(conn, '/cluster/resources?type=node').catch(() => []),
    ])

    // Check hastate from cluster resources (most reliable for HA maintenance)
    const nodeResource = (nodeResources || []).find((nr: any) => nr?.node === node)
    const hastateMaintenance = nodeResource?.hastate === 'maintenance' ? 'maintenance' : null

    // Config-based maintenance (set via node config)
    const configMaintenance = config?.maintenance || null

    return NextResponse.json({ data: { maintenance: hastateMaintenance || configMaintenance } })
  } catch (e: any) {
    console.error("[maintenance] GET Error:", e?.message)
    return NextResponse.json({ error: e?.message || "Failed to get maintenance status" }, { status: 500 })
  }
}

/**
 * POST /api/v1/connections/[id]/nodes/[node]/maintenance
 *
 * Entre en mode maintenance (PUT /nodes/{node}/config avec maintenance=upgrade)
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string; node: string }> }
) {
  try {
    const { id, node } = await ctx.params

    // RBAC
    const resourceId = buildNodeResourceId(id, node)
    const denied = await checkPermission(PERMISSIONS.NODE_MANAGE, "node", resourceId)
    if (denied) return denied

    const conn = await getConnectionById(id)
    if (!conn) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    await pveFetch(conn, `/nodes/${encodeURIComponent(node)}/config`, {
      method: 'PUT',
      body: new URLSearchParams({ maintenance: 'upgrade' }),
    })

    return NextResponse.json({ success: true })
  } catch (e: any) {
    console.error("[maintenance] POST Error:", e?.message)
    return NextResponse.json({ error: e?.message || "Failed to enter maintenance mode" }, { status: 500 })
  }
}

/**
 * DELETE /api/v1/connections/[id]/nodes/[node]/maintenance
 *
 * Sort du mode maintenance (PUT /nodes/{node}/config avec delete=maintenance)
 */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string; node: string }> }
) {
  try {
    const { id, node } = await ctx.params

    // RBAC
    const resourceId = buildNodeResourceId(id, node)
    const denied = await checkPermission(PERMISSIONS.NODE_MANAGE, "node", resourceId)
    if (denied) return denied

    const conn = await getConnectionById(id)
    if (!conn) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    await pveFetch(conn, `/nodes/${encodeURIComponent(node)}/config`, {
      method: 'PUT',
      body: new URLSearchParams({ delete: 'maintenance' }),
    })

    return NextResponse.json({ success: true })
  } catch (e: any) {
    console.error("[maintenance] DELETE Error:", e?.message)
    return NextResponse.json({ error: e?.message || "Failed to exit maintenance mode" }, { status: 500 })
  }
}
