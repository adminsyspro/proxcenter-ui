import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

// GET /api/v1/connections/{id}/nodes/{node}/storage/{storage}/content?content=iso
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; node: string; storage: string }> }
) {
  try {
    const { id, node, storage } = await ctx.params

    const denied = await checkPermission(PERMISSIONS.VM_VIEW, "connection", id)
    if (denied) return denied

    const conn = await getConnectionById(id)

    const url = new URL(req.url)
    const contentType = url.searchParams.get("content") || ""

    const query = contentType ? `?content=${encodeURIComponent(contentType)}` : ""
    // NFS/SMB stores enumerate every file and can be slow on large shares.
    // This endpoint is user-triggered (click on storage), not polled, so we
    // can afford a generous timeout. Default 8s is too short for big NFS.
    const data = await pveFetch<any[]>(
      conn,
      `/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/content${query}`,
      {},
      { timeoutMs: 30_000 }
    )

    return NextResponse.json({ data: data || [] })
  } catch (e: any) {
    console.error("Error fetching storage content:", String(e?.message || e).replace(/[\r\n]/g, ''))
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
