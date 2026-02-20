import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildVmResourceId, PERMISSIONS } from "@/lib/rbac"
import { executeSSH } from "@/lib/ssh/exec"
import { getNodeIp } from "@/lib/ssh/node-ip"

export const runtime = "nodejs"

/**
 * POST /api/v1/connections/{id}/guests/{type}/{node}/{vmid}/unlock
 *
 * Unlock a VM via SSH (qm unlock / pct unlock)
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

    // Check if the VM is locked
    const configEndpoint = `/nodes/${encodeURIComponent(node)}/${type}/${encodeURIComponent(vmid)}/config`
    const config = await pveFetch<any>(conn, configEndpoint)

    if (!config?.lock) {
      return NextResponse.json({
        data: { unlocked: false, reason: 'not_locked' },
        message: 'VM is not locked'
      })
    }

    const lockType = config.lock

    // Get node IP and execute unlock via SSH
    const nodeIp = await getNodeIp(conn, node)
    const unlockCmd = type === 'qemu' ? `qm unlock ${vmid}` : `pct unlock ${vmid}`
    const sshResult = await executeSSH(id, nodeIp, unlockCmd)

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
 * Check if a VM is locked
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
