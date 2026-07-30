import { DEFAULT_TENANT_ID } from "@/lib/tenant/constants"

export type TenantFacet = {
  id: string
  name: string
  connectionCount: number
  storageCount: number
}

/**
 * Build the tenant list backing the /storage/overview tenant selector.
 *
 * Every enabled tenant is listed, including those owning no PVE connection.
 * They legitimately show zero: a vDC storage belongs to the connection it lives
 * on, so it is already counted under that connection's owning tenant, and
 * counting it a second time here would double count it (issue #609, #569).
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
