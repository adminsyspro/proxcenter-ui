import { NextResponse } from "next/server"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"

export const runtime = "nodejs"

/**
 * GET /api/v1/connections/[id]/nodes/[node]/notes
 * 
 * Récupère les notes (description) d'un node
 * Proxmox API: GET /nodes/{node}/config -> description
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; node: string }> }
) {
  try {
    const { id, node } = await ctx.params

    const conn = await getConnectionById(id)
    if (!conn) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    const config = await pveFetch<any>(
      conn,
      `/nodes/${encodeURIComponent(node)}/config`,
      { method: "GET" }
    )

    return NextResponse.json({ 
      data: {
        notes: config?.description || '',
        digest: config?.digest || null,
      }
    })
  } catch (e: any) {
    console.error("[notes/node] Error:", e?.message)
    return NextResponse.json({ error: e?.message || "Failed to fetch notes" }, { status: 500 })
  }
}

/**
 * PUT /api/v1/connections/[id]/nodes/[node]/notes
 * 
 * Met à jour les notes (description) d'un node
 * Proxmox API: PUT /nodes/{node}/config
 */
export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string; node: string }> }
) {
  try {
    const { id, node } = await ctx.params
    const body = await req.json()
    const { notes } = body

    const conn = await getConnectionById(id)
    if (!conn) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    const params = new URLSearchParams()
    // description peut être vide pour effacer les notes
    params.append('description', notes || '')

    await pveFetch(
      conn,
      `/nodes/${encodeURIComponent(node)}/config`,
      {
        method: 'PUT',
        body: params,
      }
    )

    return NextResponse.json({ success: true })
  } catch (e: any) {
    console.error("[notes/node] PUT Error:", e?.message)
    return NextResponse.json({ error: e?.message || "Failed to update notes" }, { status: 500 })
  }
}
