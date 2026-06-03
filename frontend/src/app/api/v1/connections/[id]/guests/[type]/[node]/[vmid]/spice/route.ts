// .../spice/route.ts
import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildVmResourceId, PERMISSIONS } from "@/lib/rbac"
import { putMultiUse, readMultiUse } from "@/lib/console/session"
import { parseSpiceConfig } from "@/lib/console/spiceConfig"

export const runtime = "nodejs"

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string; type: string; node: string; vmid: string }> }
) {
  const { id, type, node, vmid } = await ctx.params

  // SPICE is QEMU-only; LXC has no SPICE server.
  if (type !== "qemu") {
    return NextResponse.json(
      { error: "SPICE is only available for QEMU virtual machines" },
      { status: 400 }
    )
  }

  const resourceId = buildVmResourceId(id, node, type, vmid)
  const denied = await checkPermission(PERMISSIONS.VM_CONSOLE, "vm", resourceId)
  if (denied) return denied

  const conn = await getConnectionById(id)
  if (!conn) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 })
  }

  try {
    // Proxmox: POST .../spiceproxy -> remote-viewer config. We omit the
    // `proxy` param so Proxmox fills it with the node address it serves
    // 3128 on. The browser does the SPICE ticket auth client-side, so the
    // password is returned; the proxyticket/ca/host-subject stay server-side.
    const cfg = await pveFetch<any>(
      conn,
      `/nodes/${encodeURIComponent(node)}/qemu/${encodeURIComponent(vmid)}/spiceproxy`,
      { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "" }
    )

    const parsed = parseSpiceConfig(cfg, conn.baseUrl)

    const sessionId = putMultiUse({
      proxyticket: parsed.proxyticket,
      proxyHost: parsed.proxyHost,
      proxyPort: parsed.proxyPort,
      tlsPort: parsed.tlsPort,
      ca: parsed.ca,
      hostSubject: parsed.hostSubject,
      insecure: conn.insecureDev,
      node,
      vmid,
    })

    return NextResponse.json({
      data: {
        sessionId,
        wsUrl: `/ws/spice/${sessionId}`,
        password: parsed.password,
      },
    })
  } catch (e: any) {
    console.error("[spice] Error:", e?.message)
    return NextResponse.json(
      { error: e?.message || "Failed to create SPICE session" },
      { status: 500 }
    )
  }
}

// Server-only helper for /api/internal/spice/consume. Multi-read within
// the TTL so spice-html5's per-channel WebSockets all resolve the same
// upstream params.
export function consumeSpiceSession(sessionId: string) {
  return readMultiUse(sessionId)
}
