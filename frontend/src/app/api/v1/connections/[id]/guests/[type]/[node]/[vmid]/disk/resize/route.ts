import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildVmResourceId, PERMISSIONS } from "@/lib/rbac"

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

    const body = await req.json()
    const { disk, size } = body

    if (!disk) {
      return NextResponse.json({ error: "Disk name is required (e.g., scsi0)" }, { status: 400 })
    }

    if (!size) {
      return NextResponse.json({ error: "Size is required (e.g., +10G)" }, { status: 400 })
    }

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
