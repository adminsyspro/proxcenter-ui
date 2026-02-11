import { NextResponse } from "next/server"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildNodeResourceId, PERMISSIONS } from "@/lib/rbac"
import { prisma } from "@/lib/db/prisma"
import { decryptSecret } from "@/lib/crypto/secret"

export const runtime = "nodejs"

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || "http://localhost:8080"

/**
 * Execute an SSH command via the orchestrator
 */
async function executeSSHCommand(
  connectionId: string,
  nodeIp: string,
  command: string
): Promise<{ success: boolean; output?: string; error?: string }> {
  const connection = await prisma.connection.findUnique({
    where: { id: connectionId },
    select: {
      sshEnabled: true,
      sshPort: true,
      sshUser: true,
      sshAuthMethod: true,
      sshKeyEnc: true,
      sshPassEnc: true,
    },
  })

  if (!connection?.sshEnabled) {
    return { success: false, error: "SSH not enabled for this connection" }
  }

  const sshCredentials: any = {
    host: nodeIp,
    port: connection.sshPort || 22,
    user: connection.sshUser || "root",
    command,
  }

  if (connection.sshKeyEnc) {
    try {
      sshCredentials.key = decryptSecret(connection.sshKeyEnc)
    } catch {
      return { success: false, error: "Failed to decrypt SSH key" }
    }
  }

  if (connection.sshPassEnc) {
    try {
      const decrypted = decryptSecret(connection.sshPassEnc)
      if (connection.sshAuthMethod === 'key') {
        sshCredentials.passphrase = decrypted
      } else {
        sshCredentials.password = decrypted
      }
    } catch {
      // Ignore passphrase decryption errors
    }
  }

  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/api/v1/ssh/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sshCredentials),
    })

    if (res.ok) {
      const data = await res.json()
      return { success: true, output: data.output }
    } else {
      const err = await res.json().catch(() => ({}))
      return { success: false, error: err?.error || res.statusText }
    }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

/**
 * Get the IP of a Proxmox node
 */
async function getNodeIp(conn: any, nodeName: string): Promise<string> {
  try {
    const clusterNodes = await pveFetch<any[]>(conn, '/cluster/config/nodes')
    const clusterNode = clusterNodes?.find((n: any) => n.name === nodeName)
    if (clusterNode?.ip) return clusterNode.ip
  } catch {}

  try {
    const networks = await pveFetch<any[]>(conn, `/nodes/${encodeURIComponent(nodeName)}/network`)
    for (const iface of networks || []) {
      if (iface.address && iface.active && !iface.address.startsWith('127.')) {
        return iface.address
      }
    }
  } catch {}

  try {
    const host = conn.host || conn.baseUrl || ''
    const cleanHost = host.replace(/^https?:\/\//, '').replace(/:\d+$/, '').replace(/\/.*$/, '')
    if (cleanHost && !cleanHost.includes('/')) return cleanHost
  } catch {}

  return nodeName
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
    const result = await executeSSHCommand(id, nodeIp, command)

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
    const result = await executeSSHCommand(id, nodeIp, command)

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
