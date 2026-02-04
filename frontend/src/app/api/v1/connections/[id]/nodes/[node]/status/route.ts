import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildNodeResourceId, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; node: string }> }
) {
  try {
    const { id, node } = await ctx.params

    // RBAC: Check node.view permission
    const resourceId = buildNodeResourceId(id, node)
    const denied = await checkPermission(PERMISSIONS.NODE_VIEW, "node", resourceId)

    if (denied) return denied

    const conn = await getConnectionById(id)

    // Proxmox: GET /nodes/{node}/status
    const status = await pveFetch<any>(
      conn,
      `/nodes/${encodeURIComponent(node)}/status`,
      { method: "GET" }
    )

    return NextResponse.json({ data: status })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

