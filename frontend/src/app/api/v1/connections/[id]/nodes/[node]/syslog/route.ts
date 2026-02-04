import { NextResponse } from "next/server"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"

export const runtime = "nodejs"

/**
 * GET /api/v1/connections/[id]/nodes/[node]/syslog
 * 
 * Récupère les logs système d'un node
 * 
 * Query params:
 * - limit: nombre de lignes (default 50)
 * - start: ligne de départ
 * - since: filtrer depuis cette date
 * - until: filtrer jusqu'à cette date
 * - service: filtrer par service
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; node: string }> }
) {
  try {
    const { id, node } = await ctx.params
    const url = new URL(req.url)
    const limit = url.searchParams.get('limit') || '100'
    const start = url.searchParams.get('start')
    const since = url.searchParams.get('since')
    const until = url.searchParams.get('until')
    const service = url.searchParams.get('service')

    const conn = await getConnectionById(id)
    if (!conn) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    // Construire les paramètres de requête
    const params = new URLSearchParams()
    params.append('limit', limit)
    if (start) params.append('start', start)
    if (since) params.append('since', since)
    if (until) params.append('until', until)
    if (service) params.append('service', service)

    const logs = await pveFetch<any[]>(
      conn,
      `/nodes/${encodeURIComponent(node)}/syslog?${params.toString()}`
    )

    // Formater les logs
    const formattedLogs = Array.isArray(logs) ? logs.map((entry: any) => {
      if (typeof entry === 'string') return entry
      // Format Proxmox: { t: "timestamp message...", n: number }
      if (entry.t && typeof entry.t === 'string') return entry.t
      if (entry.n !== undefined && entry.t) return entry.t
      return JSON.stringify(entry)
    }) : []

    return NextResponse.json({ 
      data: formattedLogs,
      total: logs?.length || 0
    })
  } catch (e: any) {
    console.error("[syslog/node] Error:", e?.message)
    return NextResponse.json({ error: e?.message || "Failed to fetch syslog" }, { status: 500 })
  }
}
