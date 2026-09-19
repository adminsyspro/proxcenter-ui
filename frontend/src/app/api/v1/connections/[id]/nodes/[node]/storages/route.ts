import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildNodeResourceId, getRequestGuestScopePerimeter, PERMISSIONS } from "@/lib/rbac"
import { vmDiskFormats } from "@/lib/proxmox/storage"
import { getCurrentTenantId } from "@/lib/tenant"
import { getTenantInfrastructureScope, maskingScope } from "@/lib/tenant/infraScope"
import { isLibraryOnlyStorage, writableStoragesFor } from "@/lib/vdc/scope"

export const runtime = "nodejs"

// GET /api/v1/connections/{id}/nodes/{node}/storages
// Récupère les storages disponibles sur un node
// Query params:
//   - content: filtrer par type de contenu (images, rootdir, iso, backup, etc.)
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; node: string }> }
) {
  try {
    const { id, node } = await ctx.params
    const { searchParams } = new URL(req.url)
    const contentFilter = searchParams.get('content') // ex: "images" pour les disques VM

    // connection.view so tenant admins reach their vDC-assigned storages;
    // vDC scope below restricts the result to their assignment.
    const resourceId = buildNodeResourceId(id, node)
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW, "node", resourceId)

    if (denied) {
      // A VM viewer needs the ISO sources for its CD/DVD picker, but this
      // does not grant access to disk, backup or mixed-content pickers.
      if (contentFilter !== 'iso') return denied
      const vmDenied = await checkPermission(PERMISSIONS.VM_VIEW, "node", resourceId)
      if (vmDenied) {
        // Flat VM/tag/pool grants cannot match a node resource. Unlike the
        // cluster-wide creation-wizard fallback, require a visible guest on
        // this node before exposing its ISO sources.
        const perimeter = await getRequestGuestScopePerimeter(id, PERMISSIONS.VM_VIEW)
        if (!(perimeter?.restricted && perimeter.holdsPermission && perimeter.hasVisibleGuests && perimeter.nodes.has(node))) {
          return vmDenied
        }
      }
    }

    const tenantId = await getCurrentTenantId()
    // Provider/MSP retain their infrastructure visibility; iaas ISO sources
    // must belong to this connection and node before resolving its client.
    const scope = maskingScope(await getTenantInfrastructureScope(tenantId))
    if (scope && contentFilter === 'iso') {
      if (!scope.storagesByConnection.get(id)?.size) {
        return NextResponse.json({ error: "Storage not accessible" }, { status: 403 })
      }
      const nodes = scope.nodesByConnection?.get(id)
      if (nodes && nodes.size > 0 && !nodes.has(node)) {
        return NextResponse.json({ error: "Node not accessible" }, { status: 403 })
      }
    }

    const conn = await getConnectionById(id)

    // PVE walks every declared storage before answering, so a datacenter with
    // many PBS targets can legitimately need far more than the default budget.
    let storages = await pveFetch<any[]>(
      conn,
      `/nodes/${encodeURIComponent(node)}/storage`,
      {},
      { slowRead: true }
    )

    // Filtrer par content si demandé
    if (contentFilter && storages) {
      storages = storages.filter(s => {
        if (!s.content) return false

        // Le champ content est une liste séparée par des virgules
        const contents = s.content.split(',').map((c: string) => c.trim())


return contents.includes(contentFilter)
      })
    }

    // Tenant filtering: restrict to storages explicitly attached to the
    // tenant's vDC scope (`primary_storage` + PBS pseudo-storages, see
    // lib/vdc/scope.ts). Super admin (scope === null) sees everything.
    //
    // Note: we used to also drop `shared === 1` storages here as a
    // defense against cross-tenant leaks on common backends. That guard
    // was correct for the legacy multi-storage vDC model, but our new
    // primary_storage design REQUIRES a shared storage (HA), so the
    // guard would silently filter out the storage the tenant is
    // supposed to deploy onto. Cross-tenant isolation now lives one
    // layer up: each vDC has its own PVE pool (`vdc-<tenant>-<vdc>`)
    // backed by RBAC, and IPAM scopes the IP range — sharing the
    // physical backend (ceph-rbd, nfs-…) is safe.
    //
    // Exception — when the caller asks for content=backup, tenants see
    // ONLY PBS targets. Local PVE storages with content=backup (vzdump
    // tarballs on `local`, NFS-backup, …) are deliberately hidden so a
    // tenant can't dump a backup onto a non-isolated provider storage —
    // PBS namespace isolation is the only supported tenant backup path.
    if (scope && storages) {
      const allowed = scope.storagesByConnection.get(id)
      // A storage reached only through an ISO library grant (#894) is an ISO
      // source: it is offered for `iso` listings and hidden from every other
      // picker (disks, backups, imports), whatever else its backend can hold.
      const wantsIso = (contentFilter ?? '').split(',').map((c: string) => c.trim()).includes('iso')
      storages = allowed
        ? storages.filter((s: any) => {
            if (!allowed.has(s.storage)) return false
            if (isLibraryOnlyStorage(scope, id, s.storage) && !wantsIso) return false
            if (contentFilter === 'backup') return s.type === 'pbs'
            return true
          })
        : []
    }

    // The per-node status carries type and content but never the format
    // capability: an explicit `format` pin and the PVE 9 LVM option
    // `snapshot-as-volume-chain` only live in the cluster storage config, and
    // that option is what decides whether qcow2 is allowed (issue #735).
    // A caller without Datastore.Audit degrades to the type-based answer
    // instead of losing the whole storage list.
    let storageConfigs: any[] = []

    try {
      storageConfigs = await pveFetch<any[]>(conn, "/storage", {}, { slowRead: true })
    } catch {
      storageConfigs = []
    }

    const configByName = new Map<string, any>()

    for (const cfg of storageConfigs || []) {
      if (cfg?.storage) configByName.set(cfg.storage, cfg)
    }

    const withFormats = (storages || []).map((s: any) => ({
      ...s,
      ...vmDiskFormats({ ...(configByName.get(s.storage) || {}), type: s.type }),
    }))

    // Storage-policy metadata for tenant pickers (spec §8.3): lets the UI
    // show the tier name and caps without a second call. iaas only (scope
    // is null for provider and msp).
    const policyMap = scope?.storagePoliciesByConnection?.get(id)
    const decorated = policyMap
      ? withFormats.map((s: any) => {
          const p = policyMap.get(s.storage)
          return p
            ? { ...s, policy: { name: p.name, iopsRd: p.iopsRd, iopsWr: p.iopsWr, mbpsRd: p.mbpsRd, mbpsWr: p.mbpsWr } }
            : s
        })
      : withFormats

    // Upload capability for the CD/DVD pickers (#894), mirroring what
    // guardTenantStorageWrite lets through: iaas tenants may upload to an ISO
    // library whose grant allows it or to a writable non-shared storage;
    // provider and MSP callers are not restricted by the guard, so every row
    // they see is uploadable.
    const withUpload = decorated.map((s: any) => {
      if (!scope) return { ...s, tenantCanUpload: true }
      const uploadLibrary = !!scope.uploadLibrariesByConnection?.get(id)?.has(s.storage)
      const writableLocal = writableStoragesFor(scope, id).has(s.storage) && !s.shared
      return { ...s, tenantCanUpload: uploadLibrary || writableLocal }
    })

    return NextResponse.json({ data: withUpload })
  } catch (e: any) {
    console.error('Error fetching storages:', e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
