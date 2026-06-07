import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildNodeResourceId, PERMISSIONS } from "@/lib/rbac"
import { getCurrentTenantId } from "@/lib/tenant"
import { getTenantInfrastructureScope, maskingScope } from "@/lib/tenant/infraScope"

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

    if (denied) return denied

    const conn = await getConnectionById(id)

    let storages = await pveFetch<any[]>(conn, `/nodes/${encodeURIComponent(node)}/storage`)

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
    const tenantId = await getCurrentTenantId()
    // provider + msp see the full cluster (maskingScope null); iaas = vDC slice.
    const scope = maskingScope(await getTenantInfrastructureScope(tenantId))
    if (scope && storages) {
      const allowed = scope.storagesByConnection.get(id)
      storages = allowed
        ? storages.filter((s: any) => {
            if (!allowed.has(s.storage)) return false
            if (contentFilter === 'backup') return s.type === 'pbs'
            return true
          })
        : []
    }

    return NextResponse.json({ data: storages || [] })
  } catch (e: any) {
    console.error('Error fetching storages:', e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
