import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildVmResourceId, PERMISSIONS } from "@/lib/rbac"
import { prisma } from "@/lib/db/prisma"
import { decryptSecret } from "@/lib/crypto/secret"
import { resolveManagementIp } from "@/lib/proxmox/resolveManagementIp"

export const runtime = "nodejs"

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || "http://localhost:8080"

/**
 * Exécute une commande SSH via l'orchestrator
 */
async function executeSSHCommand(
  connectionId: string,
  nodeIp: string,
  command: string
): Promise<{ success: boolean; output?: string; error?: string }> {
  // Récupérer les credentials SSH
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

  // Construire les credentials
  const sshCredentials: any = {
    host: nodeIp,
    port: connection.sshPort || 22,
    user: connection.sshUser || "root",
    command,
  }

  if (connection.sshKeyEnc) {
    try {
      sshCredentials.key = decryptSecret(connection.sshKeyEnc)
    } catch (e: any) {
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
    } catch (e: any) {
      // Ignore passphrase decryption errors
    }
  }

  // Appeler l'orchestrator pour exécuter la commande
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
 * Get the management IP of a Proxmox node.
 */
async function getNodeIp(conn: any, nodeName: string): Promise<string> {
  // 1. Try node network interfaces (gateway = management)
  try {
    const networks = await pveFetch<any[]>(conn, `/nodes/${encodeURIComponent(nodeName)}/network`)
    const ip = resolveManagementIp(networks)
    if (ip) return ip
  } catch {}

  // 2. Try DNS resolution of the node name
  try {
    const dns = await import('dns')
    const resolved = await dns.promises.resolve4(nodeName)
    if (resolved?.[0]) return resolved[0]
  } catch {}

  // 3. Fallback to connection host
  try {
    const host = conn.host || ''
    const cleanHost = host.replace(/^https?:\/\//, '').replace(/:\d+$/, '').replace(/\/.*$/, '')
    if (cleanHost && !cleanHost.includes('/')) return cleanHost
  } catch {}

  return nodeName
}

/**
 * POST /api/v1/connections/{id}/guests/{type}/{node}/{vmid}/unlock
 * 
 * Déverrouille une VM via SSH (qm unlock / pct unlock)
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; type: string; node: string; vmid: string }> }
) {
  try {
    const { id, type, node, vmid } = await ctx.params

    if (!id || !type || !node || !vmid) {
      return NextResponse.json({ error: "Missing parameters" }, { status: 400 })
    }

    if (type !== 'qemu' && type !== 'lxc') {
      return NextResponse.json({ error: "Invalid type. Must be 'qemu' or 'lxc'" }, { status: 400 })
    }

    // RBAC
    const resourceId = buildVmResourceId(id, node, type, vmid)
    const denied = await checkPermission(PERMISSIONS.VM_CONFIG, "vm", resourceId)
    if (denied) return denied

    const conn = await getConnectionById(id)
    if (!conn) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    // Vérifier si la VM est verrouillée
    const configEndpoint = `/nodes/${encodeURIComponent(node)}/${type}/${encodeURIComponent(vmid)}/config`
    const config = await pveFetch<any>(conn, configEndpoint)
    
    if (!config?.lock) {
      return NextResponse.json({ 
        data: { unlocked: false, reason: 'not_locked' },
        message: 'VM is not locked' 
      })
    }

    const lockType = config.lock

    // Récupérer l'IP du nœud
    const nodeIp = await getNodeIp(conn, node)

    // Exécuter unlock via SSH
    const unlockCmd = type === 'qemu' ? `qm unlock ${vmid}` : `pct unlock ${vmid}`
    const sshResult = await executeSSHCommand(id, nodeIp, unlockCmd)

    if (sshResult.success) {
      return NextResponse.json({
        data: { 
          unlocked: true, 
          previousLock: lockType,
          method: 'ssh',
          output: sshResult.output
        },
        message: `VM ${vmid} unlocked successfully (was locked: ${lockType})`
      })
    } else {
      return NextResponse.json({
        error: sshResult.error,
        lockType,
        hint: `Run manually on PVE node: ${unlockCmd}`
      }, { status: 500 })
    }

  } catch (e: any) {
    console.error(`[unlock] Error:`, e)
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

/**
 * GET /api/v1/connections/{id}/guests/{type}/{node}/{vmid}/unlock
 * 
 * Vérifie si une VM est verrouillée
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; type: string; node: string; vmid: string }> }
) {
  try {
    const { id, type, node, vmid } = await ctx.params

    if (!id || !type || !node || !vmid) {
      return NextResponse.json({ error: "Missing parameters" }, { status: 400 })
    }

    const resourceId = buildVmResourceId(id, node, type, vmid)
    const denied = await checkPermission(PERMISSIONS.VM_VIEW, "vm", resourceId)
    if (denied) return denied

    const conn = await getConnectionById(id)
    if (!conn) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    const configEndpoint = `/nodes/${encodeURIComponent(node)}/${type}/${encodeURIComponent(vmid)}/config`
    const config = await pveFetch<any>(conn, configEndpoint)

    return NextResponse.json({
      data: {
        locked: !!config?.lock,
        lockType: config?.lock || null
      }
    })

  } catch (e: any) {
    console.error(`[unlock/check] Error:`, e)
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
