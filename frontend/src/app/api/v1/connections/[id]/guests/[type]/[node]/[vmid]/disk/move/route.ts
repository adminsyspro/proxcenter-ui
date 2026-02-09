import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildVmResourceId, PERMISSIONS } from "@/lib/rbac"
import { moveDiskSchema } from "@/lib/schemas"

export const runtime = "nodejs"

// POST /api/v1/connections/{id}/guests/{type}/{node}/{vmid}/disk/move
// Déplace un disque vers un autre stockage
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
    const parseResult = moveDiskSchema.safeParse(rawBody)

    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parseResult.error.flatten() },
        { status: 400 }
      )
    }

    const { disk, storage, deleteSource, format } = parseResult.data

    const conn = await getConnectionById(id)
    
    // Déterminer le type de ressource pour l'API Proxmox
    const resourceType = type === 'lxc' ? 'lxc' : 'qemu'
    
    // Construire les paramètres
    const moveParams: Record<string, any> = {
      disk,
      storage,
    }
    
    if (deleteSource) {
      moveParams.delete = 1
    }
    
    if (format) {
      moveParams.format = format
    }
    
    // Appeler l'API Proxmox
    const endpoint = resourceType === 'qemu' 
      ? `/nodes/${encodeURIComponent(node)}/qemu/${encodeURIComponent(vmid)}/move_disk`
      : `/nodes/${encodeURIComponent(node)}/lxc/${encodeURIComponent(vmid)}/move_volume`
    
    const result = await pveFetch<string>(
      conn,
      endpoint,
      {
        method: 'POST',
        body: new URLSearchParams(
          Object.entries(moveParams).map(([k, v]) => [k, String(v)])
        ).toString(),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    )
    
    return NextResponse.json({ 
      success: true, 
      data: result,
      message: `Déplacement du disque ${disk} vers ${storage} lancé`
    })
  } catch (e: any) {
    console.error('Error moving disk:', e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
