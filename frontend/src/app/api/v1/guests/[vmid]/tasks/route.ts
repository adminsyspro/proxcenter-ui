import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildVmResourceId, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

type Params = {
  vmid: string // Format: connId:type:node:vmid
}

function parseVmKey(vmKey: string) {
  const parts = vmKey.split(':')

  if (parts.length !== 4) {
    throw new Error('Invalid vmKey format. Expected connId:type:node:vmid')
  }

  
return {
    connId: parts[0],
    type: parts[1],
    node: parts[2],
    vmid: parts[3],
  }
}

async function getConnection(id: string) {
  // Use the shared helper so vDC tenants reach provider-owned connections
  // through their vDC scope instead of getting a tenant-scoped 404.
  try {
    return await getConnectionById(id)
  } catch {
    return null
  }
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`

  if (seconds < 3600) {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60

    
return `${m}m ${s}s`
  }

  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)

  
return `${h}h ${m}m`
}

/**
 * GET /api/v1/guests/[vmid]/tasks
 * Liste les tâches récentes d'une VM
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<Params> }
) {
  try {
    const params = await ctx.params
    const { connId, type, node, vmid } = parseVmKey(params.vmid)

    // RBAC: vm.view, checked BEFORE the connection is resolved. That
    // resolution decrypts the Proxmox API token, so it must never run for a
    // caller who has no right to this guest.
    const denied = await checkPermission(
      PERMISSIONS.VM_VIEW,
      "vm",
      buildVmResourceId(connId, node, type, vmid)
    )

    if (denied) return denied

    const conn = await getConnection(connId)

    if (!conn) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    const apiPath = `/nodes/${encodeURIComponent(node)}/tasks`

    const queryParams = new URLSearchParams({
      vmid: vmid,
      limit: '50',
    })
    
    const tasks = await pveFetch<any[]>(conn, `${apiPath}?${queryParams}`)

    const formatted = (tasks || []).map(t => {
      let taskType = t.type || 'unknown'

      let status = 'running'

      if (t.status) {
        if (t.status === 'OK') status = 'success'
        else if (t.status.startsWith('WARNINGS')) status = 'warning'
        else status = 'error'
      }

      return {
        upid: t.upid,
        type: taskType,
        status,
        statusText: t.status || null,
        starttime: t.starttime || 0,
        endtime: t.endtime || null,
        duration: t.endtime && t.starttime
          ? t.endtime - t.starttime
          : null,
        durationFormatted: t.endtime && t.starttime
          ? formatDuration(t.endtime - t.starttime)
          : null,
        user: t.user || '-',
        node: t.node || node,
      }
    }).sort((a, b) => b.starttime - a.starttime)

    return NextResponse.json({
      data: {
        tasks: formatted,
        count: formatted.length,
      }
    })
  } catch (e: any) {
    console.error("Tasks list error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
