import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildNodeResourceId, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

// GET /api/v1/connections/{id}/nodes/{node}/cpu-models
// Liste les modèles CPU QEMU disponibles sur un node (builtin + modèles custom
// du cluster définis dans /etc/pve/virtual-guest/cpu-models.conf).
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

    const models = await pveFetch<any[]>(
      conn,
      `/nodes/${encodeURIComponent(node)}/capabilities/qemu/cpu`
    )

    return NextResponse.json({ data: Array.isArray(models) ? models : [] })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
