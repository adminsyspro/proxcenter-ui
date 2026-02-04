import { NextResponse } from "next/server"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"

export const runtime = "nodejs"

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; node: string }> }
) {
  const { id, node } = await ctx.params

  const conn = await getConnectionById(id)
  if (!conn) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 })
  }

  try {
    // Récupérer la liste des mises à jour disponibles
    const updates = await pveFetch<any[]>(
      conn,
      `/nodes/${encodeURIComponent(node)}/apt/update`
    )

    // Récupérer aussi la version Proxmox du nœud
    const version = await pveFetch<any>(
      conn,
      `/nodes/${encodeURIComponent(node)}/version`
    )

    return NextResponse.json({
      data: {
        updates: updates || [],
        count: updates?.length || 0,
        version: version?.version || null,
        release: version?.release || null,
      }
    })
  } catch (error: any) {
    console.error(`Error fetching updates for node ${node}:`, error)
    return NextResponse.json({ 
      error: error.message || "Failed to fetch updates",
      data: { updates: [], count: 0, version: null, release: null }
    }, { status: 500 })
  }
}
