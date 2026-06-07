import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { guardTenantStorageWrite } from "@/lib/vdc/scope"
import { getTenantInfrastructureScope, maskingScope } from "@/lib/tenant/infraScope"
import { getCurrentTenantId } from "@/lib/tenant"
import { prisma } from "@/lib/db/prisma"

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

    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW, "connection", id)
    if (denied) return denied

    const storageBlock = await guardTenantStorageWrite(id, storage)
    if (storageBlock) return storageBlock

    const conn = await getConnectionById(id)

    // The volid is URL-encoded; Proxmox expects the full volid (storage:path)
    const decodedVolid = decodeURIComponent(volid)

    // Tenant-ownership guard for the controlled content types. Volid format
    // is "<storage>:<contentType>/<filename>" — extract contentType and the
    // filename, refuse delete on iso/import volumes whose filename doesn't
    // match `custom-<tenantSlug>-*`. Super admins (scope===null) skip this.
    const tenantId = await getCurrentTenantId()
    // provider + msp own the full cluster (maskingScope null → no prefix guard);
    // iaas tenants keep the per-tenant filename-ownership check below.
    const scope = maskingScope(await getTenantInfrastructureScope(tenantId))
    if (scope) {
      const m = decodedVolid.match(/^[^:]+:([^/]+)\/(.+)$/)
      const itemContent = m?.[1] || ''
      const filename = m?.[2] || ''
      if (TENANT_FILTERED_CONTENT.has(itemContent)) {
        const row = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { slug: true } })
        const tenantSlug = row?.slug || tenantId.replace(/[^a-z0-9-]/gi, '').toLowerCase()
        if (!filename.startsWith(`custom-${tenantSlug}-`)) {
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
