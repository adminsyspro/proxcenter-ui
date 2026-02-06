import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildVmResourceId, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ id: string; type: string; node: string; vmid: string; action: string }>
}

// Map action names to RBAC permissions
const ACTION_PERMISSIONS: Record<string, string> = {
  start: PERMISSIONS.VM_START,
  stop: PERMISSIONS.VM_STOP,
  shutdown: PERMISSIONS.VM_STOP,
  reboot: PERMISSIONS.VM_RESTART,
  reset: PERMISSIONS.VM_RESTART,
  suspend: PERMISSIONS.VM_SUSPEND,
  resume: PERMISSIONS.VM_SUSPEND,
}

// Valid actions that can be performed on VMs
const VALID_ACTIONS = ['start', 'stop', 'shutdown', 'reboot', 'reset', 'suspend', 'resume']

/**
 * POST /api/v1/connections/[id]/guests/[type]/[node]/[vmid]/[action]
 *
 * Execute an action on a VM (start, stop, shutdown, reboot, suspend, resume)
 */
export async function POST(_req: Request, ctx: RouteContext) {
  try {
    const { id, type, node, vmid, action } = await ctx.params

    if (!id || !type || !node || !vmid || !action) {
      return NextResponse.json({ error: "Missing parameters" }, { status: 400 })
    }

    // Validate action
    if (!VALID_ACTIONS.includes(action)) {
      return NextResponse.json({
        error: `Invalid action: ${action}. Valid actions are: ${VALID_ACTIONS.join(', ')}`
      }, { status: 400 })
    }

    // RBAC: Check permission for this action
    const permission = ACTION_PERMISSIONS[action]

    if (permission) {
      const resourceId = buildVmResourceId(id, node, type, vmid)
      const denied = await checkPermission(permission, "vm", resourceId)

      if (denied) return denied
    }

    // Get connection
    const conn = await getConnectionById(id)

    if (!conn) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    // Execute action via Proxmox API
    const endpoint = `/nodes/${encodeURIComponent(node)}/${encodeURIComponent(type)}/${encodeURIComponent(vmid)}/status/${action}`

    const result = await pveFetch<any>(conn, endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    })

    return NextResponse.json({
      data: result,
      node,
      connId: id,
      message: `Action '${action}' executed on ${type}/${vmid}`
    })
  } catch (e: any) {
    console.error(`[guest/action] Error:`, e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
