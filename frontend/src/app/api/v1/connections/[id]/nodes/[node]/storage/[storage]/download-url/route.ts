import { NextResponse } from "next/server"

import { downloadToStorage, PveDownloadPermissionError } from "@/lib/proxmox/download"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { guardTenantStorageWrite, tenantUploadFilename } from "@/lib/vdc/scope"

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

    const body = await req.json()

    const { url, content, filename } = body
    if (!url || !content || !filename) {
      return NextResponse.json(
        { error: "url, content and filename are required" },
        { status: 400 }
      )
    }

    // On an ISO library that allows uploads, a tenant's file is namespaced
    // `custom-<slug>-*` server-side and the guard then only lets the tenant
    // write its own files (#894).
    const targetName = await tenantUploadFilename(id, storage, String(filename))
    const storageBlock = await guardTenantStorageWrite(id, storage, { filename: targetName, content: String(content) })
    if (storageBlock) return storageBlock

    const conn = await getConnectionById(id)

    const params = new URLSearchParams({
      url,
      content,
      filename: targetName,
      node,
      storage,
      "verify-certificates": "0",
    })

    const result = await downloadToStorage(conn, node, storage, params)

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
    return NextResponse.json({ error: e?.message || String(e) }, { status: e instanceof PveDownloadPermissionError ? 403 : 500 })
  }
}
