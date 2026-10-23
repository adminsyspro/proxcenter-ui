import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { audit } from "@/lib/audit"
import { withPublicApiGuard } from "@/lib/api-tokens/routeGuard"
import { withAudit } from "@/lib/audit/withAudit"
import { sdnOwnVnets } from "@/lib/vdc/sdnReadScope"

export const runtime = "nodejs"

async function postHandler(
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
    // The apply is cluster-wide: it would push other tenants' pending changes
    // too. A vDC tenant's own VNets are applied by the vDC routes (roadmap#81).
    if (await sdnOwnVnets(id)) {
      return NextResponse.json({ error: "Applying the cluster SDN configuration is reserved to the provider" }, { status: 403 })
    }

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

export const POST = withAudit({ category: "sdn", resourceType: "sdn", resourceParam: "id", action: "apply" }, withPublicApiGuard("sdn-apply", postHandler))
