import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { guardTenantStorageWrite, loadTenantSlugs, resolveUploadOwner } from "@/lib/vdc/scope"
import { getTenantInfrastructureScope, maskingScope } from "@/lib/tenant/infraScope"
import { getCurrentTenantId } from "@/lib/tenant"

export const runtime = "nodejs"

// Content types where we enforce filename-prefix ownership for tenants —
// kept in sync with the listing route so a tenant can't delete a sibling
// tenant's ISO/import even by guessing the volid.
const TENANT_FILTERED_CONTENT = new Set(['iso', 'import'])

// DELETE /api/v1/connections/{id}/nodes/{node}/storage/{storage}/content/{volid}
// Delete a volume from Proxmox storage
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string; node: string; storage: string; volid: string }> }
) {
  try {
    const { id, node, storage, volid } = await ctx.params

    const denied = await checkPermission(PERMISSIONS.STORAGE_DELETE, "connection", id)
    if (denied) return denied

    // The volid is URL-encoded; Proxmox expects the full volid (storage:path)
    const decodedVolid = decodeURIComponent(volid)
    // Volid format is "<storage>:<contentType>/<filename>".
    const volidMatch = decodedVolid.match(/^[^:]+:([^/]+)\/(.+)$/)
    const itemContent = volidMatch?.[1] || ''
    const filename = volidMatch?.[2] || ''

    // The guard needs the target filename: on an ISO library that allows
    // uploads a tenant may only delete its own `custom-<slug>-*` files (#894).
    const storageBlock = await guardTenantStorageWrite(id, storage, { filename })
    if (storageBlock) return storageBlock

    const conn = await getConnectionById(id)

    // Tenant-ownership guard for the controlled content types: refuse delete
    // on iso/import volumes whose filename doesn't match
    // `custom-<tenantSlug>-*`. Super admins (scope===null) skip this.
    const tenantId = await getCurrentTenantId()
    // provider + msp own the full cluster (maskingScope null → no prefix guard);
    // iaas tenants keep the per-tenant filename-ownership check below.
    const scope = maskingScope(await getTenantInfrastructureScope(tenantId))
    if (scope) {
      if (TENANT_FILTERED_CONTENT.has(itemContent)) {
        // Longest-slug ownership: `custom-acme-prod-x` is acme-prod's, not acme's.
        const { mine, all } = await loadTenantSlugs(tenantId)
        const owner = resolveUploadOwner(filename, all)
        if (owner.kind !== 'tenant' || owner.slug !== mine) {
          return NextResponse.json({ error: "Volume not accessible" }, { status: 403 })
        }
      }
    }

    await pveFetch<any>(
      conn,
      `/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/content/${encodeURIComponent(decodedVolid)}`,
      { method: "DELETE" }
    )

    const { audit } = await import("@/lib/audit")
    await audit({
      action: "delete" as any,
      category: "storage",
      resourceType: "storage",
      resourceId: storage,
      details: { node, connectionId: id, volid: decodedVolid },
    })

    return NextResponse.json({ success: true })
  } catch (e: any) {
    console.error("Error deleting storage content:", e)
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
