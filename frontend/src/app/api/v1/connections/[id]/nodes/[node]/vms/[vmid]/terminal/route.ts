import { NextResponse } from "next/server"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"

export const runtime = "nodejs"

/**
 * POST /api/v1/connections/[id]/nodes/[node]/vms/[vmid]/terminal?type=qemu|lxc
 *
 * Creates a terminal session for a VM or LXC container.
 *
 * Strategy: Use a NODE-level termproxy (which works reliably), then the
 * ws-proxy auto-sends `pct enter {vmid}` (LXC) or `qm terminal {vmid}` (QEMU)
 * to attach to the guest from the node shell.
 * This bypasses the broken VM/LXC vncwebsocket handler in PVE.
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

    // Resolve the target node IP (termproxy binds locally)
    let targetHost = host
    try {
      const clusterStatus = await pveFetch<any[]>(conn, '/cluster/status')
      const targetNode = clusterStatus?.find((n: any) => n.type === 'node' && n.name === node)
      if (targetNode?.ip) {
        targetHost = targetNode.ip
      }
    } catch {
      // Fallback to connection host
    }

    const targetConn = targetHost !== host
      ? { ...conn, baseUrl: `https://${targetHost}:${port}` }
      : conn

    // Use NODE-level termproxy (not VM-level — VM vncwebsocket is broken cross-node)
    const termproxy = await pveFetch<any>(
      targetConn,
      `/nodes/${encodeURIComponent(node)}/termproxy`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }
    )

    if (!termproxy || !termproxy.ticket) {
      return NextResponse.json({ error: "Failed to create terminal session" }, { status: 500 })
    }

    // The auto-command to attach to the VM/LXC from the node shell
    const autoCmd = vmType === 'lxc'
      ? `pct enter ${vmid}\n`
      : `qm terminal ${vmid}\n`

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
        vmType,
        vmid,
        autoCmd,
      },
    })
  } catch (e: any) {
    console.error("[terminal/vm] Error:", e?.message)
    return NextResponse.json({ error: e?.message || "Failed to create terminal session" }, { status: 500 })
  }
}
