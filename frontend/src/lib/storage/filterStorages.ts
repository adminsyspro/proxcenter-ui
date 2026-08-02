import type { AggregatedStorage } from "@/lib/proxmox/storage"

export type StorageScopeFilter = 'all' | 'shared' | 'local'

export type StorageFilterCriteria = {
  /** Connection id, or '*' for every connection. */
  connId: string
  /** Free text, matched on storage, node, type, connection name and tenant name. */
  query: string
  /** Storage type, or 'all'. */
  type: string
  scope: StorageScopeFilter
  /**
   * Selected tenant ids. `null` disables tenant filtering, which is the case for
   * a caller that is not fleet-scoped: every row already belongs to its own
   * tenant. An empty array selects nothing (issue #609).
   */
  tenantIds: string[] | null
}

/** Apply the /storage/overview filter bar to the aggregated storage rows. */
export function filterStorages<T extends Partial<AggregatedStorage>>(
  rows: T[],
  criteria: StorageFilterCriteria
): T[] {
  const { connId, query, type, scope, tenantIds } = criteria
  const q = query.trim().toLowerCase()
  const tenantSet = tenantIds ? new Set(tenantIds) : null

  return rows.filter(s => {
    const matchConn =
      connId === '*' || s.connections?.some(c => c.id === connId) || s.connId === connId

    const matchTenant = !tenantSet || (!!s.tenantId && tenantSet.has(s.tenantId))

    const matchQ =
      !q ||
      s.storage?.toLowerCase().includes(q) ||
      s.node?.toLowerCase().includes(q) ||
      s.type?.toLowerCase().includes(q) ||
      s.connectionName?.toLowerCase().includes(q) ||
      s.tenantName?.toLowerCase().includes(q)

    const matchType = type === 'all' || s.type === type

    const matchScope =
      scope === 'all' || (scope === 'shared' && s.shared) || (scope === 'local' && !s.shared)

    return !!(matchConn && matchTenant && matchQ && matchType && matchScope)
  })
}
