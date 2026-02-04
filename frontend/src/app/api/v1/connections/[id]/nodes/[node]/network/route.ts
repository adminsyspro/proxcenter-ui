import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildNodeResourceId, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

// GET /api/v1/connections/{id}/nodes/{node}/network
// Récupère les interfaces réseau disponibles sur un node
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; node: string }> }
) {
  try {
    const { id, node } = await ctx.params

    // RBAC: Check node.network permission
    const resourceId = buildNodeResourceId(id, node)
    const denied = await checkPermission(PERMISSIONS.NODE_NETWORK, "node", resourceId)

    if (denied) return denied

    const conn = await getConnectionById(id)

    const networks = await pveFetch<any[]>(conn, `/nodes/${encodeURIComponent(node)}/network`)

    return NextResponse.json({ data: networks || [] })
  } catch (e: any) {
    console.error('Error fetching network interfaces:', e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
