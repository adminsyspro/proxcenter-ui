import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildNodeResourceId, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

/**
 * GET /api/v1/connections/[id]/nodes/[node]/apt/repositories
 * Returns repository configuration for a node (standard_repos and errors)
 *
 * Proxmox API: GET /nodes/{node}/apt/repositories
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; node: string }> }
) {
  try {
    const { id, node } = await ctx.params

    const resourceId = buildNodeResourceId(id, node)
    const denied = await checkPermission(PERMISSIONS.NODE_VIEW, "node", resourceId)

    if (denied) return denied

    const conn = await getConnectionById(id)

    const result = await pveFetch<any>(
      conn,
      `/nodes/${encodeURIComponent(node)}/apt/repositories`,
      { method: "GET" }
    )

    return NextResponse.json({
      data: {
        standard_repos: result?.standard_repos || [],
        errors: result?.errors || [],
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
