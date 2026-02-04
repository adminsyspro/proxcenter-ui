import { NextResponse } from "next/server"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"

export const runtime = "nodejs"

/**
 * GET /api/v1/connections/[id]/nodes/[node]/report
 * 
 * Génère un rapport système complet pour un node
 * Proxmox API: GET /nodes/{node}/report
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; node: string }> }
) {
  try {
    const { id, node } = await ctx.params

    const conn = await getConnectionById(id)

    // Proxmox: GET /nodes/{node}/report
    const report = await pveFetch<string>(
      conn,
      `/nodes/${encodeURIComponent(node)}/report`,
      { method: "GET" }
    )

    return NextResponse.json({ data: report })
  } catch (e: any) {
    console.error("[report/node] Error:", e?.message)
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
