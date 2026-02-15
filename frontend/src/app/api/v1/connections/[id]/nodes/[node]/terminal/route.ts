import { NextResponse } from "next/server"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"

export const runtime = "nodejs"

/**
 * POST /api/v1/connections/[id]/nodes/[node]/terminal
 * 
 * Crée une session terminal (shell) pour un node
 * Proxmox API: POST /nodes/{node}/termproxy
 * 
 * Retourne les informations nécessaires pour établir une connexion WebSocket
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string; node: string }> }
) {
  try {
    const { id, node } = await ctx.params

    const conn = await getConnectionById(id)
    if (!conn) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    // Parser le baseUrl pour extraire host et port
    let host = ''
    let port = 8006
    try {
      const url = new URL(conn.baseUrl)
      host = url.hostname
      port = url.port ? parseInt(url.port) : 8006
    } catch {
      // Si le parsing échoue, essayer de parser manuellement
      const match = conn.baseUrl.match(/https?:\/\/([^:/]+)(?::(\d+))?/)
      if (match) {
        host = match[1]
        port = match[2] ? parseInt(match[2]) : 8006
      }
    }

    if (!host) {
      return NextResponse.json({ error: "Could not determine host from connection" }, { status: 500 })
    }

    // Resolve the actual IP of the target node (termproxy binds locally on that node)
    let targetHost = host
    try {
      const clusterStatus = await pveFetch<any[]>(conn, '/cluster/status')
      const targetNode = clusterStatus?.find((n: any) => n.type === 'node' && n.name === node)
      if (targetNode?.ip) {
        targetHost = targetNode.ip
      }
    } catch {
      // Fallback to connection host if cluster status fails (single-node setup)
    }

    // Créer une session terminal via l'API Proxmox
    // POST /nodes/{node}/termproxy
    const termproxy = await pveFetch<any>(
      conn,
      `/nodes/${encodeURIComponent(node)}/termproxy`,
      {
        method: "POST",
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    )

    if (!termproxy || !termproxy.ticket) {
      return NextResponse.json({ error: "Failed to create terminal session" }, { status: 500 })
    }

    // Construire l'URL WebSocket pour le terminal
    const wsUrl = `wss://${targetHost}:${port}/api2/json/nodes/${encodeURIComponent(node)}/vncwebsocket?port=${termproxy.port}&vncticket=${encodeURIComponent(termproxy.ticket)}`

    return NextResponse.json({
      data: {
        ticket: termproxy.ticket,
        port: termproxy.port,
        user: termproxy.user,
        upid: termproxy.upid,
        wsUrl,
        host: targetHost,
        nodePort: port,
        apiToken: conn.apiToken,
      }
    })
  } catch (e: any) {
    console.error("[terminal/node] Error:", e?.message)
    return NextResponse.json({ error: e?.message || "Failed to create terminal session" }, { status: 500 })
  }
}
