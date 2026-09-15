import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, guestPerimeterAllows, PERMISSIONS } from "@/lib/rbac"
import { getCurrentTenantId } from "@/lib/tenant"
import { getTenantInfrastructureScope, maskingScope } from "@/lib/tenant/infraScope"
import { isLibraryOnlyStorage, loadTenantSlugs, resolveUploadOwner } from "@/lib/vdc/scope"

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

    // Flat-scoped callers (vm/tag/pool) never match a connection resource, so
    // the ISO picker of the creation wizard used to 403 (issue #262). The vDC
    // storage mask below still applies to them unchanged.
    const denied = await checkPermission(PERMISSIONS.VM_VIEW, "connection", id)

    if (denied && !(await guestPerimeterAllows(id, PERMISSIONS.VM_VIEW))) return denied

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
      // A per-node storage id (`local`) exists on every node: only the vDC's
      // own nodes may be browsed, or a tenant could read another node's copy.
      const nodes = scope.nodesByConnection?.get(id)
      if (nodes && nodes.size > 0 && !nodes.has(node)) {
        return NextResponse.json({ error: "Node not accessible" }, { status: 403 })
      }
    }
    // ISO library (#894): the provider's catalogue (files without a
    // `custom-` prefix) is visible to every vDC granted the storage; files
    // uploaded by a tenant (`custom-<slug>-*`) stay visible to their owner
    // only. A storage reached ONLY through a library grant is an ISO source
    // and nothing else: its images, backups or templates are never listed.
    const isIsoLibrary = !!scope?.isoLibrariesByConnection?.get(id)?.has(storage)
    const libraryOnly = !!scope && isLibraryOnlyStorage(scope, id, storage)

    // Ownership of tenant-prefixed files is resolved on the longest matching
    // slug (`custom-acme-prod-x` belongs to acme-prod, never to acme). Super
    // admins skip this entirely — they get the unfiltered listing.
    let slugs: { mine: string; all: string[] } | null = null
    if (scope) slugs = await loadTenantSlugs(tenantId)

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
    if (slugs) {
      const { mine, all } = slugs
      payload = payload.filter((item: any) => {
        const itemContent = String(item?.content || '')
        if (libraryOnly && itemContent !== 'iso') return false
        if (!TENANT_FILTERED_CONTENT.has(itemContent)) return true
        const volid: string = String(item?.volid || '')
        const slash = volid.lastIndexOf('/')
        if (slash < 0) return false
        const owner = resolveUploadOwner(volid.slice(slash + 1), all)
        if (owner.kind === 'tenant') return owner.slug === mine
        // Provider catalogue is visible on a library only; a `custom-` file
        // matching no tenant is nobody's and stays hidden.
        return isIsoLibrary && owner.kind === 'provider'
      })
    }

    return NextResponse.json({ data: payload })
  } catch (e: any) {
    console.error("Error fetching storage content:", String(e?.message || e).replace(/[\r\n]/g, ''))
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
