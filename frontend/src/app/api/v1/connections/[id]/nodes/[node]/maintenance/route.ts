import { NextResponse } from "next/server"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildNodeResourceId, PERMISSIONS } from "@/lib/rbac"
import { executeSSH } from "@/lib/ssh/exec"
import { getNodeIp } from "@/lib/ssh/node-ip"

export const runtime = "nodejs"

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
    if (!conn) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    const nodeResources = await pveFetch<any[]>(conn, '/cluster/resources?type=node').catch(() => [])
    const nodeResource = (nodeResources || []).find((nr: any) => nr?.node === node)
    const maintenance = nodeResource?.hastate === 'maintenance' ? 'maintenance' : null

    return NextResponse.json({ data: { maintenance } })
  } catch (e: any) {
    console.error("[maintenance] GET Error:", e?.message)
    return NextResponse.json({ error: e?.message || "Failed to get maintenance status" }, { status: 500 })
  }
}

/**
 * POST /api/v1/connections/[id]/nodes/[node]/maintenance
 *
 * Enter maintenance mode via SSH: ha-manager crm-command node-maintenance enable <node>
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string; node: string }> }
) {
  try {
    const { id, node } = await ctx.params

    const resourceId = buildNodeResourceId(id, node)
    const denied = await checkPermission(PERMISSIONS.NODE_MANAGE, "node", resourceId)
    if (denied) return denied

    const conn = await getConnectionById(id)
    if (!conn) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    const nodeIp = await getNodeIp(conn, node)
    const command = `ha-manager crm-command node-maintenance enable ${node}`

    console.log(`[maintenance] POST ${node}: executing via SSH on ${nodeIp}: ${command}`)
    const result = await executeSSH(id, nodeIp, command)

    if (result.success) {
      return NextResponse.json({ success: true, method: 'ssh', output: result.output })
    } else {
      return NextResponse.json({
        error: result.error,
        hint: `Run manually on a PVE node: ${command}`
      }, { status: 500 })
    }
  } catch (e: any) {
    console.error("[maintenance] POST Error:", e?.message)
    return NextResponse.json({ error: e?.message || "Failed to enter maintenance mode" }, { status: 500 })
  }
}

/**
 * DELETE /api/v1/connections/[id]/nodes/[node]/maintenance
 *
 * Exit maintenance mode via SSH: ha-manager crm-command node-maintenance disable <node>
 */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string; node: string }> }
) {
  try {
    const { id, node } = await ctx.params

    const resourceId = buildNodeResourceId(id, node)
    const denied = await checkPermission(PERMISSIONS.NODE_MANAGE, "node", resourceId)
    if (denied) return denied

    const conn = await getConnectionById(id)
    if (!conn) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    const nodeIp = await getNodeIp(conn, node)
    const command = `ha-manager crm-command node-maintenance disable ${node}`

    console.log(`[maintenance] DELETE ${node}: executing via SSH on ${nodeIp}: ${command}`)
    const result = await executeSSH(id, nodeIp, command)

    if (result.success) {
      return NextResponse.json({ success: true, method: 'ssh', output: result.output })
    } else {
      return NextResponse.json({
        error: result.error,
        hint: `Run manually on a PVE node: ${command}`
      }, { status: 500 })
    }
  } catch (e: any) {
    console.error("[maintenance] DELETE Error:", e?.message)
    return NextResponse.json({ error: e?.message || "Failed to exit maintenance mode" }, { status: 500 })
  }
}
