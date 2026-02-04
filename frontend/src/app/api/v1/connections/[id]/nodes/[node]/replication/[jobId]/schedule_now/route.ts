import { NextResponse } from "next/server"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"

export const runtime = "nodejs"

// POST - Exécuter immédiatement un job de réplication
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
    // Exécuter le job de réplication immédiatement
    const result = await pveFetch(
      conn,
      `/nodes/${encodeURIComponent(node)}/replication/${encodeURIComponent(jobId)}/schedule_now`,
      { method: 'POST' }
    )

    return NextResponse.json({ data: result, success: true })
  } catch (error: any) {
    console.error(`Error scheduling replication job:`, error)
    return NextResponse.json({ 
      error: error.message || "Failed to schedule replication job"
    }, { status: 500 })
  }
}
