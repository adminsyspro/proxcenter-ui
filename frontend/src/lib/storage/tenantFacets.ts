import { DEFAULT_TENANT_ID } from "@/lib/tenant/constants"

export type TenantFacet = {
  id: string
  name: string
  connectionCount: number
  storageCount: number
}

/**
 * Drop the tenants that only ever reach storage through a vDC.
 *
 * A vDC is mapped to a whole connection, and that connection belongs to the
 * provider tenant, so the vDC's storages are already listed under the provider.
 * Such a tenant could therefore only ever show a permanently empty entry, which
 * is the misleading "this page looks broken" symptom of issue #609 all over
 * again. A tenant that ALSO owns a PVE connection stays listed, otherwise its
 * own storages would become unattributable in the selector.
 */
export function selectableTenants<T extends { id: string }>(
  tenants: T[],
  vdcTenantIds: string[],
  connections: { tenantId: string }[]
): T[] {
  const owners = new Set(connections.map(c => c.tenantId))
  const vdcOnly = new Set(vdcTenantIds.filter(id => !owners.has(id)))

  return tenants.filter(t => !vdcOnly.has(t.id))
}

/**
 * Build the tenant list backing the /storage/overview tenant selector.
 *
 * Every tenant handed in is listed, including those owning no PVE connection:
 * an MSP tenant with no connection yet legitimately shows zero. Tenants whose
 * only reach is a vDC are filtered out upstream by selectableTenants, since a
 * vDC storage belongs to the connection it lives on and is therefore already
 * counted under that connection's owning tenant; counting it a second time here
 * would double count it (issue #609, #569).
 *
 * The provider tenant sorts first, the rest alphabetically by name.
 */
export function buildTenantFacets(
  tenants: { id: string; name: string }[],
  connections: { tenantId: string }[],
  rows: { tenantId?: string | null }[]
): TenantFacet[] {
  const connectionCount = new Map<string, number>()

  for (const c of connections) {
    connectionCount.set(c.tenantId, (connectionCount.get(c.tenantId) || 0) + 1)
  }

  const storageCount = new Map<string, number>()

  for (const r of rows) {
    if (r.tenantId) storageCount.set(r.tenantId, (storageCount.get(r.tenantId) || 0) + 1)
  }

  return tenants
    .map(t => ({
      id: t.id,
      name: t.name,
      connectionCount: connectionCount.get(t.id) || 0,
      storageCount: storageCount.get(t.id) || 0,
    }))
    .sort((a, b) => {
      if (a.id === DEFAULT_TENANT_ID) return -1
      if (b.id === DEFAULT_TENANT_ID) return 1

      return a.name.localeCompare(b.name)
    })
}
