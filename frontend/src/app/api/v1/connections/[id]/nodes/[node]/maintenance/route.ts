import { NextResponse } from "next/server"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById, isConnectionNotFoundError } from "@/lib/connections/getConnection"
import { checkPermission, buildNodeResourceId, PERMISSIONS } from "@/lib/rbac"
import { executeSSH } from "@/lib/ssh/exec"
import { getNodeIp } from "@/lib/ssh/node-ip"

export const runtime = "nodejs"

// Map a thrown error to the right HTTP response: a genuine not-found becomes a
// 404, everything else (DB/crypto/infra) surfaces as a 500 with the original
// message. Shared by all three handlers so the not-found vs real-error
// distinction lives in one place.
function maintenanceError(label: string, e: any, fallback: string): NextResponse {
  console.error(`[maintenance] ${label} Error:`, e?.message)
  if (isConnectionNotFoundError(e)) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 })
  }
  return NextResponse.json({ error: e?.message || fallback }, { status: 500 })
}

// Enter (enable) or exit (disable) HA maintenance on a node via SSH. POST and
// DELETE are identical bar the verb, so the whole body lives here.
async function toggleMaintenance(
  ctx: { params: Promise<{ id: string; node: string }> },
  enable: boolean
): Promise<NextResponse> {
  const label = enable ? 'POST' : 'DELETE'
  const fallback = enable ? 'Failed to enter maintenance mode' : 'Failed to exit maintenance mode'
  try {
    const { id, node } = await ctx.params

    const resourceId = buildNodeResourceId(id, node)
    const denied = await checkPermission(PERMISSIONS.NODE_MANAGE, "node", resourceId)
    if (denied) return denied

    const conn = await getConnectionById(id)

    const nodeIp = await getNodeIp(conn, node)
    const command = `ha-manager crm-command node-maintenance ${enable ? 'enable' : 'disable'} ${node}`

    console.log(`[maintenance] ${label} ${node}: executing via SSH on ${nodeIp}: ${command}`)
    const result = await executeSSH(id, nodeIp, command)

    if (result.success) {
      return NextResponse.json({ success: true, method: 'ssh', output: result.output })
    }
    return NextResponse.json({
      error: result.error,
      hint: `Run manually on a PVE node: ${command}`
    }, { status: 500 })
  } catch (e: any) {
    return maintenanceError(label, e, fallback)
  }
}

/**
 * GET /api/v1/connections/[id]/nodes/[node]/maintenance
 *
 * Returns current maintenance status via hastate from cluster resources.
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

    const nodeResources = await pveFetch<any[]>(conn, '/cluster/resources?type=node')
    const nodeResource = (nodeResources || []).find((nr: any) => nr?.node === node)
    const maintenance = nodeResource?.hastate === 'maintenance' ? 'maintenance' : null

    return NextResponse.json({ data: { maintenance } })
  } catch (e: any) {
    return maintenanceError('GET', e, 'Failed to get maintenance status')
  }
}

/**
 * POST /api/v1/connections/[id]/nodes/[node]/maintenance
 *
 * Enter maintenance mode via SSH: ha-manager crm-command node-maintenance enable <node>
 */
export function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string; node: string }> }
) {
  return toggleMaintenance(ctx, true)
}

/**
 * DELETE /api/v1/connections/[id]/nodes/[node]/maintenance
 *
 * Exit maintenance mode via SSH: ha-manager crm-command node-maintenance disable <node>
 */
export function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string; node: string }> }
) {
  return toggleMaintenance(ctx, false)
}
