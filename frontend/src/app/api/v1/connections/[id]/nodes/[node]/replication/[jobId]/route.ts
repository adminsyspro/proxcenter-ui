import { NextResponse } from "next/server"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"

export const runtime = "nodejs"

// GET - Récupérer les logs d'un job de réplication
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; node: string; jobId: string }> }
) {
  const { id, node, jobId } = await ctx.params
  const url = new URL(req.url)
  const limit = url.searchParams.get('limit') || '50'

  const conn = await getConnectionById(id)
  if (!conn) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 })
  }

  try {
    // Proxmox: GET /nodes/{node}/replication/{id}/log
    const logs = await pveFetch<any[]>(
      conn,
      `/nodes/${encodeURIComponent(node)}/replication/${encodeURIComponent(jobId)}/log?limit=${limit}`,
      { method: "GET" }
    )

    // Formater les logs
    const formattedLogs = Array.isArray(logs) ? logs.map((entry: any) => {
      if (typeof entry === 'string') return entry
      if (entry.t && typeof entry.t === 'string') return entry.t
      return JSON.stringify(entry)
    }) : []

    return NextResponse.json({ data: formattedLogs })
  } catch (error: any) {
    console.error(`Error fetching replication logs:`, error)
    return NextResponse.json({ 
      error: error.message || "Failed to fetch replication logs",
      data: []
    }, { status: 500 })
  }
}

// POST - Exécuter immédiatement un job de réplication (Schedule now)
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string; node: string; jobId: string }> }
) {
  const { id, node, jobId } = await ctx.params

  const conn = await getConnectionById(id)
  if (!conn) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 })
  }

  try {
    // Proxmox: POST /nodes/{node}/replication/{id}/schedule_now
    const result = await pveFetch(
      conn,
      `/nodes/${encodeURIComponent(node)}/replication/${encodeURIComponent(jobId)}/schedule_now`,
      { method: 'POST' }
    )

    return NextResponse.json({ success: true, data: result })
  } catch (error: any) {
    console.error(`Error scheduling replication job:`, error)
    return NextResponse.json({ 
      error: error.message || "Failed to schedule replication job"
    }, { status: 500 })
  }
}

// DELETE - Supprimer un job de réplication
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string; node: string; jobId: string }> }
) {
  const { id, node, jobId } = await ctx.params

  const conn = await getConnectionById(id)
  if (!conn) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 })
  }

  try {
    // Supprimer le job de réplication via l'API cluster
    await pveFetch(
      conn,
      `/cluster/replication/${encodeURIComponent(jobId)}`,
      { method: 'DELETE' }
    )

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error(`Error deleting replication job:`, error)
    return NextResponse.json({ 
      error: error.message || "Failed to delete replication job"
    }, { status: 500 })
  }
}
