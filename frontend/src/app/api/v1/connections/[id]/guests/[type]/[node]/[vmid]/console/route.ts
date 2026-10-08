import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildVmResourceId, PERMISSIONS } from "@/lib/rbac"
import { putSingleUse, takeSingleUse } from "@/lib/console/session"
import { audit } from "@/lib/audit"

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

  // Proxmox records the vncproxy task under the technical API identity
  // ProxCenter connects with, so the PVE task log cannot tell which operator
  // opened the console. Every attempt is journaled here under the
  // authenticated ProxCenter user; the UPID ties the row to the PVE task so
  // the Events view can show both identities side by side.
  const auditConsole = (status: "success" | "failure", details: Record<string, unknown>, errorMessage?: string) =>
    audit({
      action: "console.open",
      category: type === "lxc" ? "containers" : "vms",
      resourceType: type,
      resourceId: vmid,
      details: { connectionId: id, node, ...details },
      status,
      errorMessage,
    }).catch(() => {})

  const conn = await getConnectionById(id)
  if (!conn) {
    await auditConsole("failure", {}, "Connection not found")

    return NextResponse.json({ error: "Connection not found" }, { status: 404 })
  }

  // Proxmox: POST .../vncproxy (option websocket=1)
  let responseBaseUrl = conn.baseUrl
  let data: any
  try {
    data = await pveFetch<any>(
      conn,
      `/nodes/${encodeURIComponent(node)}/${encodeURIComponent(type)}/${encodeURIComponent(vmid)}/vncproxy`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "websocket=1",
      },
      { onResponse: url => { responseBaseUrl = url } }
    )
  } catch (e: any) {
    const message = e?.message || String(e)
    await auditConsole("failure", { connectionName: conn.name }, message)

    return NextResponse.json({ error: message }, { status: 500 })
  }

  // Only the UPID is kept: the ticket, port and certificate are session
  // secrets and must never reach the journal or the SIEM forwarder.
  await auditConsole("success", { connectionName: conn.name, upid: data?.upid ?? null })

  const expiresAt = Date.now() + 30_000
  const sessionId = putSingleUse({
    baseUrl: responseBaseUrl,
    apiToken: conn.apiToken,
    insecure: conn.insecureDev,
    node,
    type,
    vmid,
    port: data.port,
    ticket: data.ticket,
    expiresAt,
  })

  const baseUrl = new URL(responseBaseUrl)
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
