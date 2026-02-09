import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildVmResourceId, PERMISSIONS } from "@/lib/rbac"
import { resizeDiskSchema } from "@/lib/schemas"

export const runtime = "nodejs"

// POST /api/v1/connections/{id}/guests/{type}/{node}/{vmid}/disk/resize
// Redimensionne un disque (agrandissement uniquement)
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; type: string; node: string; vmid: string }> }
) {
  try {
    const { id, type, node, vmid } = await ctx.params

    // RBAC: Check vm.config permission
    const resourceId = buildVmResourceId(id, node, type, vmid)
    const denied = await checkPermission(PERMISSIONS.VM_CONFIG, "vm", resourceId)

    if (denied) return denied

    const rawBody = await req.json()
    const parseResult = resizeDiskSchema.safeParse(rawBody)

    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parseResult.error.flatten() },
        { status: 400 }
      )
    }

    const { disk, size } = parseResult.data

    const conn = await getConnectionById(id)
    
    // Déterminer le type de ressource pour l'API Proxmox
    const resourceType = type === 'lxc' ? 'lxc' : 'qemu'
    
    // Construire les paramètres
    const resizeParams: Record<string, any> = {
      disk,
      size,
    }
    
    // Appeler l'API Proxmox
    const endpoint = resourceType === 'qemu' 
      ? `/nodes/${encodeURIComponent(node)}/qemu/${encodeURIComponent(vmid)}/resize`
      : `/nodes/${encodeURIComponent(node)}/lxc/${encodeURIComponent(vmid)}/resize`
    
    const result = await pveFetch<string>(
      conn,
      endpoint,
      {
        method: 'PUT',
        body: new URLSearchParams(
          Object.entries(resizeParams).map(([k, v]) => [k, String(v)])
        ).toString(),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    )
    
    return NextResponse.json({ 
      success: true, 
      data: result,
      message: `Disque ${disk} redimensionné de ${size}`
    })
  } catch (e: any) {
    console.error('Error resizing disk:', e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
