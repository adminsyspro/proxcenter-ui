import { NextResponse } from "next/server"

import { downloadToStorage, PveDownloadPermissionError } from "@/lib/proxmox/download"
import { getConnectionById } from "@/lib/connections/getConnection"
import { buildStorageResourceId, checkPermission, PERMISSIONS } from "@/lib/rbac"
import { guardTenantStorageWrite, tenantUploadFilename } from "@/lib/vdc/scope"
import { getPrincipal, type Principal } from "@/lib/auth/principal"
import { getTenantInfrastructureScope } from "@/lib/tenant/infraScope"
import { withPublicApiGuard } from "@/lib/api-tokens/routeGuard"

export const runtime = "nodejs"

/**
 * The node fetches the URL itself, follows redirects and resolves the name on
 * its own, so no check made here can keep it off a private network: a vDC
 * tenant, token or session, may not have the provider's node download
 * anything. A token may moreover only name an http(s) URL.
 */
async function isVdcTenant(tenantId: string): Promise<boolean> {
  return (await getTenantInfrastructureScope(tenantId, { ignoreVdcContext: true })).kind === "iaas"
}

async function tokenUrlRefusal(principal: Principal, url: unknown): Promise<string | null> {
  let protocol = ""
  try {
    protocol = new URL(String(url)).protocol
  } catch {
    // Not a URL: refused like any other scheme.
  }
  if (protocol !== "http:" && protocol !== "https:") return "Download URL not allowed for this token"
  return (await isVdcTenant(principal.tenantId)) ? "Download URL not available to a vDC tenant token" : null
}

/** The session's own tenant, the one its grants were just judged in (no provider fallback). */
async function sessionUrlRefusal(): Promise<string | null> {
  const tenantId = (await getPrincipal()).principal?.tenantId
  return tenantId && (await isVdcTenant(tenantId)) ? "Download URL not available to a vDC tenant" : null
}

// POST /api/v1/connections/{id}/nodes/{node}/storage/{storage}/download-url
// Download a file from a URL to Proxmox storage (ISO, CT template, etc.)
async function postHandler(
  req: Request,
  ctx: { params: Promise<{ id: string; node: string; storage: string }>; principal?: Principal }
) {
  try {
    const { id, node, storage } = await ctx.params

    // Judged on the storage itself (issue #921).
    const denied = await checkPermission(PERMISSIONS.STORAGE_UPLOAD, "storage", buildStorageResourceId(id, storage))
    if (denied) return denied

    const body = await req.json()

    const { url, content, filename } = body
    if (!url || !content || !filename) {
      return NextResponse.json(
        { error: "url, content and filename are required" },
        { status: 400 }
      )
    }

    const urlRefusal = ctx.principal?.kind === "token" ? await tokenUrlRefusal(ctx.principal, url) : await sessionUrlRefusal()
    if (urlRefusal) return NextResponse.json({ error: urlRefusal }, { status: 403 })

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

export const POST = withPublicApiGuard("storage-download-url", postHandler)
