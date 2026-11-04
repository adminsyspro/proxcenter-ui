import { NextResponse } from "next/server"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { withAudit } from "@/lib/audit/withAudit"
import { denyIaasTenant } from "@/lib/tenant/iaasGuard"
import { providerPveRead } from "@/lib/connections/providerPveRead"

export const runtime = "nodejs"

// GET - List all matchers (closed to an IaaS tenant).
export const GET = providerPveRead({
  permission: PERMISSIONS.CONNECTION_VIEW,
  on: "connection",
  path: () => "/cluster/notifications/matchers",
  shape: "list",
})

// POST - Create a matcher
async function handlePost(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const iaasDenied = await denyIaasTenant()
  if (iaasDenied) return iaasDenied

  try {
    const { id } = await ctx.params
    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })
    const denied = await checkPermission(PERMISSIONS.CONNECTION_MANAGE, "connection", id)
    if (denied) return denied
    const conn = await getConnectionById(id)
    const body = await req.json()

    const updateParams = new URLSearchParams()
    for (const [k, v] of Object.entries(body)) {
      if (v !== undefined && v !== '') updateParams.set(k, String(v))
    }

    await pveFetch<any>(conn, "/cluster/notifications/matchers", {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: updateParams.toString(),
    })
    return NextResponse.json({ data: { success: true } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export const POST = withAudit({ category: "cluster", resourceType: "cluster_notifications_matcher", resourceParam: "id" }, handlePost)
