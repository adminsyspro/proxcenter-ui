/**
 * Synchronous VM metadata index for tag/pool RBAC resolution.
 *
 * Builds a Map<resourceId, VmMeta> from the existing in-memory inventory
 * cache so that scopeMatches() can resolve tags/pool without async I/O.
 *
 * The index is lazily rebuilt every 30 seconds (piggybacks on inventory's 2-min TTL).
 * On cache miss (cold start), returns null → tag/pool scopes can't match → safe denial.
 *
 * Per-tenant indexes to ensure tenant isolation.
 */

import { getInventoryFromCache } from "./inventoryCache"

export interface VmMeta {
  tags: string[]
  pool?: string
}

type TenantIndex = {
  index: Map<string, VmMeta>
  lastBuild: number
}

const tenantIndexes = new Map<string, TenantIndex>()

function rebuildIndex(tenantId: string): Map<string, VmMeta> | null {
  const cache = getInventoryFromCache(tenantId)
  if (cache.status === "miss") return null

  const idx = new Map<string, VmMeta>()

  for (const cluster of cache.data.clusters) {
    for (const node of cluster.nodes || []) {
      for (const g of (node.guests || []) as any[]) {
        const rid = `${cluster.id}:${node.node}:${g.type}:${g.vmid}`
        const tags =
          typeof g.tags === "string"
            ? g.tags
                .split(/[;,]/)
                .map((t: string) => t.trim())
                .filter(Boolean)
            : []
        idx.set(rid, { tags, pool: g.pool || undefined })
      }
    }
  }

  tenantIndexes.set(tenantId, { index: idx, lastBuild: Date.now() })
  return idx
}

export function resolveVmMeta(resourceId: string, tenantId = 'default'): VmMeta | null {
  const existing = tenantIndexes.get(tenantId)
  if (!existing || Date.now() - existing.lastBuild > 30_000) {
    const idx = rebuildIndex(tenantId)
    if (!idx) return null
    return idx.get(resourceId) ?? null
  }
  return existing.index.get(resourceId) ?? null
}
