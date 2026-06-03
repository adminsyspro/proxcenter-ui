// .../termproxy/route.ts
import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildVmResourceId, PERMISSIONS } from "@/lib/rbac"
import { putSingleUse } from "@/lib/console/session"

export const runtime = "nodejs"

// Guest serial console (xterm.js). QEMU needs a serial0 device; Proxmox
// errors otherwise and we surface a clear message (Match-Proxmox, no
// auto-config). LXC always works. Reuses the /ws/shell relay (identical
// termproxy handshake) via a guest-scoped upstream base path.
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string; type: string; node: string; vmid: string }> }
) {
  const { id, type, node, vmid } = await ctx.params

  const resourceId = buildVmResourceId(id, node, type, vmid)
  const denied = await checkPermission(PERMISSIONS.VM_CONSOLE, "vm", resourceId)
  if (denied) return denied

  const conn = await getConnectionById(id)
  if (!conn) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 })
  }

  let termproxy: any
  try {
    termproxy = await pveFetch<any>(
      conn,
      `/nodes/${encodeURIComponent(node)}/${encodeURIComponent(type)}/${encodeURIComponent(vmid)}/termproxy`,
      { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "" }
    )
  } catch (e: any) {
    const msg = String(e?.message || "")
    if (/serial/i.test(msg)) {
      return NextResponse.json(
        { error: "This VM has no serial device. Add a serial port (serial0) to use the xterm.js console." },
        { status: 400 }
      )
    }
    return NextResponse.json({ error: msg || "Failed to create serial session" }, { status: 500 })
  }

  if (!termproxy || !termproxy.ticket) {
    return NextResponse.json({ error: "Failed to create serial session" }, { status: 500 })
  }

  let host = ""
  let pvePort = 8006
  try {
    const u = new URL(conn.baseUrl)
    host = u.hostname
    pvePort = u.port ? Number.parseInt(u.port) : 8006
  } catch {
    const m = conn.baseUrl.match(/https?:\/\/([^:/]+)(?::(\d+))?/)
    if (m) { host = m[1]; pvePort = m[2] ? Number.parseInt(m[2]) : 8006 }
  }

  const expiresAt = Date.now() + 30_000
  const sessionId = putSingleUse({
    baseUrl: conn.baseUrl,
    host,
    pvePort,
    apiToken: conn.apiToken,
    insecure: conn.insecureDev,
    node,
    port: Number(termproxy.port),
    ticket: termproxy.ticket,
    user: termproxy.user,
    upid: termproxy.upid,
    upstreamBasePath: `/api2/json/nodes/${encodeURIComponent(node)}/${encodeURIComponent(type)}/${encodeURIComponent(vmid)}`,
    expiresAt,
  })

  return NextResponse.json({ data: { sessionId, wsUrl: `/ws/shell/${sessionId}`, host, node, expiresAt } })
}
