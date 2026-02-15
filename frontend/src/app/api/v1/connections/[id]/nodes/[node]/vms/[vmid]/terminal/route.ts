import { NextResponse } from "next/server"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"

export const runtime = "nodejs"

/**
 * POST /api/v1/connections/[id]/nodes/[node]/vms/[vmid]/terminal?type=qemu|lxc
 *
 * Creates a terminal (xterm.js) session for a VM or LXC container.
 * Proxmox API: POST /nodes/{node}/qemu/{vmid}/termproxy
 *           or POST /nodes/{node}/lxc/{vmid}/termproxy
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; node: string; vmid: string }> }
) {
  try {
    const { id, node, vmid } = await ctx.params
    const { searchParams } = new URL(req.url)
    const vmType = searchParams.get("type") || "qemu"

    if (vmType !== "qemu" && vmType !== "lxc") {
      return NextResponse.json({ error: "Invalid type, must be qemu or lxc" }, { status: 400 })
    }

    const conn = await getConnectionById(id)
    if (!conn) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    let host = ""
    let port = 8006
    try {
      const url = new URL(conn.baseUrl)
      host = url.hostname
      port = url.port ? parseInt(url.port) : 8006
    } catch {
      const match = conn.baseUrl.match(/https?:\/\/([^:/]+)(?::(\d+))?/)
      if (match) {
        host = match[1]
        port = match[2] ? parseInt(match[2]) : 8006
      }
    }

    if (!host) {
      return NextResponse.json({ error: "Could not determine host from connection" }, { status: 500 })
    }

    // POST /nodes/{node}/qemu/{vmid}/termproxy  or  /nodes/{node}/lxc/{vmid}/termproxy
    const termproxy = await pveFetch<any>(
      conn,
      `/nodes/${encodeURIComponent(node)}/${vmType}/${encodeURIComponent(vmid)}/termproxy`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }
    )

    if (!termproxy || !termproxy.ticket) {
      return NextResponse.json({ error: "Failed to create terminal session" }, { status: 500 })
    }

    // Use the connection host — Proxmox API routes vncwebsocket to the correct node internally
    const wsUrl = `wss://${host}:${port}/api2/json/nodes/${encodeURIComponent(node)}/${vmType}/${encodeURIComponent(vmid)}/vncwebsocket?port=${termproxy.port}&vncticket=${encodeURIComponent(termproxy.ticket)}`

    return NextResponse.json({
      data: {
        ticket: termproxy.ticket,
        port: termproxy.port,
        user: termproxy.user,
        upid: termproxy.upid,
        wsUrl,
        host,
        nodePort: port,
        apiToken: conn.apiToken,
        vmType,
        vmid,
      },
    })
  } catch (e: any) {
    console.error("[terminal/vm] Error:", e?.message)
    return NextResponse.json({ error: e?.message || "Failed to create terminal session" }, { status: 500 })
  }
}
