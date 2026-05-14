import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { guardTenantStorageWrite } from "@/lib/vdc/scope"

export const runtime = "nodejs"

// POST /api/v1/connections/{id}/nodes/{node}/storage/{storage}/download-url
// Download a file from a URL to Proxmox storage (ISO, CT template, etc.)
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; node: string; storage: string }> }
) {
  try {
    const { id, node, storage } = await ctx.params

    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW, "connection", id)

    if (denied) return denied

    const storageBlock = await guardTenantStorageWrite(id, storage)

    if (storageBlock) return storageBlock

    const conn = await getConnectionById(id)
    const body = await req.json()

    const { url, content, filename } = body

    if (!url || !content || !filename) {
      return NextResponse.json(
        { error: "url, content and filename are required" },
        { status: 400 }
      )
    }

    const params = new URLSearchParams({
      url,
      content,
      filename,
      node,
      storage,
      "verify-certificates": "0",
    })

    const result = await pveFetch<any>(
      conn,
      `/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/download-url`,
      {
        method: "POST",
        body: params.toString(),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }
    )

    const { audit } = await import("@/lib/audit")

    await audit({
      action: "update" as any,
      category: "storage",
      resourceType: "storage",
      resourceId: storage,
      details: { node, connectionId: id, content, filename, url, operation: "download-url" },
    })

    return NextResponse.json({ success: true, data: result })
  } catch (e: any) {
    console.error("Error downloading URL to storage:", e)

return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
