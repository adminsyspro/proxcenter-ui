import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getCurrentTenantId } from "@/lib/tenant"
import { getTenantInfrastructureScope, maskingScope } from "@/lib/tenant/infraScope"
import { prisma } from "@/lib/db/prisma"

export const runtime = "nodejs"

// Content types where ProxCenter writes tenant-prefixed files
// (`custom-<slug>-*`) via the templates flow. On these we filter the
// listing by tenant ownership so cross-tenant enumeration is impossible
// on storages shared between vDCs (e.g. a single `local` ISO store
// attached to multiple tenants). Files without the prefix are treated as
// "unknown ownership" and dropped for tenants — explicit decision to
// not guess ownership of legacy / manually-dropped files.
const TENANT_FILTERED_CONTENT = new Set(['iso', 'import'])

// GET /api/v1/connections/{id}/nodes/{node}/storage/{storage}/content?content=iso
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; node: string; storage: string }> }
) {
  try {
    const { id, node, storage } = await ctx.params

    const denied = await checkPermission(PERMISSIONS.VM_VIEW, "connection", id)
    if (denied) return denied

    // Tenants may browse content (mainly ISOs for the VM create picker) ONLY
    // on storages assigned to their vDC — super admins are unrestricted
    // (getVdcScope returns null for them). Stops cross-tenant enumeration on
    // shared storages the tenant never attached.
    const tenantId = await getCurrentTenantId()
    // provider + msp see the full cluster (maskingScope null → no filtering);
    // iaas tenants are restricted to their vDC storages.
    const scope = maskingScope(await getTenantInfrastructureScope(tenantId))
    if (scope) {
      const allowed = scope.storagesByConnection.get(id)
      if (!allowed || !allowed.has(storage)) {
        return NextResponse.json({ error: "Storage not accessible" }, { status: 403 })
      }
    }

    // Resolve the tenant slug used as the filename prefix (`custom-<slug>-*`).
    // Mirrors the convention applied by POST /custom-images. Super admins
    // skip this lookup entirely — they get the unfiltered listing.
    let tenantSlug: string | null = null
    if (scope) {
      const row = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { slug: true } })
      tenantSlug = row?.slug || tenantId.replace(/[^a-z0-9-]/gi, '').toLowerCase()
    }

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

    // Tenant ownership filter — applied per-item using each item's `content`
    // attribute. We can't shortcut on the request's `?content=` param because
    // PVE accepts comma-separated lists (`?content=images,import`) and a
    // mixed listing must keep VM disks visible while filtering imports.
    //
    // Rule (tenant only): drop items whose content type is in
    // TENANT_FILTERED_CONTENT and whose volid filename does NOT start with
    // `custom-<tenantSlug>-`. Other content types (images, vztmpl, backup, …)
    // have their own ownership models handled elsewhere — VM disks via PVE
    // pool, backups via PBS namespace.
    let payload = data || []
    if (tenantSlug) {
      const ownPrefix = `custom-${tenantSlug}-`
      payload = payload.filter((item: any) => {
        const itemContent = String(item?.content || '')
        if (!TENANT_FILTERED_CONTENT.has(itemContent)) return true
        const volid: string = String(item?.volid || '')
        const slash = volid.lastIndexOf('/')
        if (slash < 0) return false
        return volid.slice(slash + 1).startsWith(ownPrefix)
      })
    }

    return NextResponse.json({ data: payload })
  } catch (e: any) {
    console.error("Error fetching storage content:", String(e?.message || e).replace(/[\r\n]/g, ''))
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
