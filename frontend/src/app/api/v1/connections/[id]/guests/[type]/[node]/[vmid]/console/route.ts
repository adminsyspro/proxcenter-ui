import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildVmResourceId, PERMISSIONS } from "@/lib/rbac"
import { putSingleUse, takeSingleUse } from "@/lib/console/session"

export const runtime = "nodejs"

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string; type: string; node: string; vmid: string }> }
) {
  const { id, type, node, vmid } = await ctx.params

  // RBAC: Check vm.console permission
  const resourceId = buildVmResourceId(id, node, type, vmid)
  const denied = await checkPermission(PERMISSIONS.VM_CONSOLE, "vm", resourceId)
  if (denied) return denied

  const conn = await getConnectionById(id)
  if (!conn) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 })
  }

  // Proxmox: POST .../vncproxy (option websocket=1)
  const data = await pveFetch<any>(
    conn,
    `/nodes/${encodeURIComponent(node)}/${encodeURIComponent(type)}/${encodeURIComponent(vmid)}/vncproxy`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "websocket=1",
    }
  )

  const expiresAt = Date.now() + 30_000
  const sessionId = putSingleUse({
    baseUrl: conn.baseUrl,
    apiToken: conn.apiToken,
    insecure: conn.insecureDev,
    node,
    type,
    vmid,
    port: data.port,
    ticket: data.ticket,
    expiresAt,
  })

  const baseUrl = new URL(conn.baseUrl)
  const novncUrl = `${baseUrl.origin}/?console=${type}&novnc=1&vmid=${vmid}&vmname=VM${vmid}&node=${node}&resize=off&cmd=`

  return NextResponse.json({
    data: {
      sessionId,
      wsUrl: `/ws/console/${sessionId}`,
      password: data.ticket,
      expiresAt,
      novncUrl,
      port: data.port,
      ticket: data.ticket,
    },
  })
}

// export pour le service WS — thin wrapper over the shared store so the
// /api/internal/console/consume route and its tests are unchanged.
export function consumeConsoleSession(sessionId: string) {
  return takeSingleUse(sessionId)
}
