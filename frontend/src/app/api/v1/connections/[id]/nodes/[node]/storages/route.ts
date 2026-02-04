import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildNodeResourceId, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

// GET /api/v1/connections/{id}/nodes/{node}/storages
// Récupère les storages disponibles sur un node
// Query params:
//   - content: filtrer par type de contenu (images, rootdir, iso, backup, etc.)
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; node: string }> }
) {
  try {
    const { id, node } = await ctx.params
    const { searchParams } = new URL(req.url)
    const contentFilter = searchParams.get('content') // ex: "images" pour les disques VM

    // RBAC: Check storage.view permission
    const resourceId = buildNodeResourceId(id, node)
    const denied = await checkPermission(PERMISSIONS.STORAGE_VIEW, "node", resourceId)

    if (denied) return denied

    const conn = await getConnectionById(id)

    let storages = await pveFetch<any[]>(conn, `/nodes/${encodeURIComponent(node)}/storage`)
    
    // Filtrer par content si demandé
    if (contentFilter && storages) {
      storages = storages.filter(s => {
        if (!s.content) return false

        // Le champ content est une liste séparée par des virgules
        const contents = s.content.split(',').map((c: string) => c.trim())

        
return contents.includes(contentFilter)
      })
    }

    return NextResponse.json({ data: storages || [] })
  } catch (e: any) {
    console.error('Error fetching storages:', e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
