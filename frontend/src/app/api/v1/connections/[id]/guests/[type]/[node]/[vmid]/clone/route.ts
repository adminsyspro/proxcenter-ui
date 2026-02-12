import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildVmResourceId, PERMISSIONS } from "@/lib/rbac"
import { cloneVmSchema } from "@/lib/schemas"
import { invalidateInventoryCache } from "@/lib/cache/inventoryCache"

export const runtime = "nodejs"

// POST /api/v1/connections/{id}/guests/{type}/{node}/{vmid}/clone
// Clone a VM or template
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

    // RBAC: Check vm.clone permission
    const resourceId = buildVmResourceId(id, node, type, vmid)
    const denied = await checkPermission(PERMISSIONS.VM_CLONE, "vm", resourceId)

    if (denied) return denied

    const conn = await getConnectionById(id)
    const rawBody = await req.json()

    const parseResult = cloneVmSchema.safeParse(rawBody)

    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parseResult.error.flatten() },
        { status: 400 }
      )
    }

    const body = parseResult.data

    // Construire l'URL Proxmox pour le clone
    const endpoint = `/nodes/${encodeURIComponent(node)}/${type}/${encodeURIComponent(vmid)}/clone`

    // Convertir le body en format URL-encoded (Proxmox attend ce format)
    const formData = new URLSearchParams()

    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined && value !== null && value !== '') {
        formData.append(key, String(value))
      }
    }

    // Appeler l'API Proxmox pour cloner la VM
    const result = await pveFetch<any>(conn, endpoint, {
      method: "POST",
      body: formData.toString(),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    })

    invalidateInventoryCache()

    return NextResponse.json({
      data: result,
      message: `Clone operation started`
    })
  } catch (e: any) {
    console.error('Error cloning VM:', e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
