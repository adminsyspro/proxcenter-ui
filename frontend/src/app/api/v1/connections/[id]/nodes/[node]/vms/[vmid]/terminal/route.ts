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

    // Resolve the actual IP of the target node.
    // Proxmox does NOT proxy vncwebsocket cross-node — both termproxy and
    // vncwebsocket must hit the SAME node where the VM/LXC runs.
    let targetHost = host
    try {
      const clusterStatus = await pveFetch<any[]>(conn, '/cluster/status')
      const nodes = clusterStatus?.filter((n: any) => n.type === 'node')
      console.log(`[terminal/vm] Cluster nodes:`, nodes?.map((n: any) => `${n.name}=${n.ip}`).join(', '))
      const targetNode = nodes?.find((n: any) => n.name === node)
      if (targetNode?.ip) {
        targetHost = targetNode.ip
        console.log(`[terminal/vm] Resolved ${node} -> ${targetHost}`)
      } else {
        console.log(`[terminal/vm] Node ${node} not found in cluster status, using connection host ${host}`)
      }
    } catch (e: any) {
      console.log(`[terminal/vm] cluster/status failed: ${e?.message}, using connection host ${host}`)
    }

    // Build a connection object pointing directly to the target node
    // so that termproxy runs locally on that node (not proxied through another node)
    const targetConn = targetHost !== host
      ? { ...conn, baseUrl: `https://${targetHost}:${port}` }
      : conn

    // POST /nodes/{node}/qemu/{vmid}/termproxy  or  /nodes/{node}/lxc/{vmid}/termproxy
    console.log(`[terminal/vm] Calling termproxy on ${targetConn.baseUrl} for ${vmType}/${vmid}`)
    const termproxy = await pveFetch<any>(
      targetConn,
      `/nodes/${encodeURIComponent(node)}/${vmType}/${encodeURIComponent(vmid)}/termproxy`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }
    )

    if (!termproxy || !termproxy.ticket) {
      return NextResponse.json({ error: "Failed to create terminal session" }, { status: 500 })
    }

    console.log(`[terminal/vm] termproxy OK: port=${termproxy.port}, user=${termproxy.user}`)

    const wsUrl = `wss://${targetHost}:${port}/api2/json/nodes/${encodeURIComponent(node)}/${vmType}/${encodeURIComponent(vmid)}/vncwebsocket?port=${termproxy.port}&vncticket=${encodeURIComponent(termproxy.ticket)}`

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
      },
    })
  } catch (e: any) {
    console.error("[terminal/vm] Error:", e?.message)
    return NextResponse.json({ error: e?.message || "Failed to create terminal session" }, { status: 500 })
  }
}
