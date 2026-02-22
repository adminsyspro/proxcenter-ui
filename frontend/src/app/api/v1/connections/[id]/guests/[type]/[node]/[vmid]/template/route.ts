import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildVmResourceId, PERMISSIONS } from "@/lib/rbac"
import { invalidateInventoryCache } from "@/lib/cache/inventoryCache"

export const runtime = "nodejs"

// POST /api/v1/connections/{id}/guests/{type}/{node}/{vmid}/template
// Convert a VM to a template (irreversible, VM must be stopped)
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; type: string; node: string; vmid: string }> | { id: string; type: string; node: string; vmid: string } }
) {
  try {
    const params = await Promise.resolve(ctx.params)
    const { id, type, node, vmid } = params as { id: string; type: string; node: string; vmid: string }

    if (!id || !type || !node || !vmid) {
      return NextResponse.json({ error: "Missing required parameters" }, { status: 400 })
    }

    if (type !== 'qemu' && type !== 'lxc') {
      return NextResponse.json({ error: "Type must be 'qemu' or 'lxc'" }, { status: 400 })
    }

    // RBAC: Check vm.config permission (converting to template modifies VM config)
    const resourceId = buildVmResourceId(id, node, type, vmid)
    const denied = await checkPermission(PERMISSIONS.VM_CONFIG, "vm", resourceId)

    if (denied) return denied

    const conn = await getConnectionById(id)

    // Proxmox endpoint: POST /nodes/{node}/{qemu|lxc}/{vmid}/template
    const endpoint = `/nodes/${encodeURIComponent(node)}/${type}/${encodeURIComponent(vmid)}/template`

    const result = await pveFetch<any>(conn, endpoint, {
      method: "POST",
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    })

    invalidateInventoryCache()

    return NextResponse.json({
      data: result,
      message: "Convert to template operation started"
    })
  } catch (e: any) {
    console.error('Error converting VM to template:', e)

    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
