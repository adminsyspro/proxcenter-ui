import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { audit } from "@/lib/audit"

export const runtime = "nodejs"

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  let connId: string = ""
  try {
    const { id } = await ctx.params
    connId = id
    const permError = await checkPermission(PERMISSIONS.CONNECTION_MANAGE, "connection", id)
    if (permError) return permError
    const conn = await getConnectionById(id)
    if (!conn) return NextResponse.json({ error: "Connection not found" }, { status: 404 })

    const upid = await pveFetch<string>(conn, "/cluster/sdn", { method: "PUT" })

    // Best-effort audit; do not fail the apply if audit write throws.
    try {
      await audit({
        action: "sdn.apply",
        category: "sdn",
        resourceType: "connection",
        resourceId: id,
        details: { upid },
        status: "success",
      })
    } catch (auditErr) {
      console.warn("Failed to write sdn.apply audit row:", auditErr)
    }

    return NextResponse.json({ data: { upid } })
  } catch (e: any) {
    console.error("Error applying SDN:", e)
    if (connId) {
      try {
        await audit({
          action: "sdn.apply",
          category: "sdn",
          resourceType: "connection",
          resourceId: connId,
          status: "failure",
          errorMessage: e?.message || String(e),
        })
      } catch {}
    }
    return NextResponse.json({ error: e?.message || String(e) }, { status: 502 })
  }
}
