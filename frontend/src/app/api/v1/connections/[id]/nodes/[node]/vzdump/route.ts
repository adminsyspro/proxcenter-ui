import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildNodeResourceId, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

// POST /api/v1/connections/{id}/nodes/{node}/vzdump
// Lance une sauvegarde de VM/CT
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; node: string }> }
) {
  try {
    const { id, node } = await ctx.params

    // RBAC: Check backup permission
    const resourceId = buildNodeResourceId(id, node)
    const denied = await checkPermission(PERMISSIONS.VM_BACKUP, "node", resourceId)

    if (denied) return denied

    const body = await req.json()
    const { vmid, storage, mode = 'snapshot', compress = 'zstd', notes } = body

    if (!vmid) {
      return NextResponse.json({ error: "VMID is required" }, { status: 400 })
    }

    if (!storage) {
      return NextResponse.json({ error: "Storage is required" }, { status: 400 })
    }

    const conn = await getConnectionById(id)
    
    // Construire les paramètres pour vzdump
    const vzdumpParams: Record<string, any> = {
      vmid: vmid,
      storage: storage,
      mode: mode,
      compress: compress,
    }
    
    if (notes) {
      vzdumpParams.notes = notes
    }
    
    // Appeler l'API Proxmox vzdump
    const result = await pveFetch<string>(
      conn,
      `/nodes/${encodeURIComponent(node)}/vzdump`,
      {
        method: 'POST',
        body: new URLSearchParams(
          Object.entries(vzdumpParams).map(([k, v]) => [k, String(v)])
        ).toString(),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    )
    
    return NextResponse.json({ 
      success: true, 
      data: result,
      message: `Sauvegarde de VM ${vmid} lancée`
    })
  } catch (e: any) {
    console.error('Error creating backup:', e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
