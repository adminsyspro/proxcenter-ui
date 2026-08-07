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

import { getTenantInventoriesFromCache } from "./inventoryCache"

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
  // Merge every warm inventory of this tenant across vDC view contexts
  // (issue #633 regression class): with an active context cookie, every
  // browser inventory read warms `t::<vdcId>` and `t::all` can go stale or
  // stay cold, so reading only the union key would go blind on tag/pool
  // RBAC and alert visibility. A narrowed entry holds a SUBSET of the
  // tenant's guests, so merging only adds coverage — the tenant-prefix
  // scoping of getTenantInventoriesFromCache means this can never leak
  // another tenant's data. Entries come back freshest-first; the first
  // hit for a resourceId is kept, so the freshest entry wins on conflict.
  const inventories = getTenantInventoriesFromCache(tenantId)
  if (inventories.length === 0) return null

  const idx = new Map<string, VmMeta>()

  for (const cache of inventories) {
    for (const cluster of cache.clusters) {
      for (const node of cluster.nodes || []) {
        for (const g of (node.guests || []) as any[]) {
          const rid = `${cluster.id}:${node.node}:${g.type}:${g.vmid}`
          if (idx.has(rid)) continue
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

/**
 * Find a VM's metadata by `(connectionId, vmid)` regardless of node or
 * type. Used when the caller has only a vmid (e.g. orchestrator alerts
 * whose payload doesn't carry a `node`).
 *
 * Returns null on cache miss or no match.
 */
export function findVmMetaByVmid(
  connectionId: string,
  vmid: number | string,
  tenantId = 'default',
): VmMeta | null {
  const existing = tenantIndexes.get(tenantId)
  if (!existing || Date.now() - existing.lastBuild > 30_000) {
    if (!rebuildIndex(tenantId)) return null
  }
  const idx = tenantIndexes.get(tenantId)?.index
  if (!idx) return null

  const target = String(vmid)
  const prefix = `${connectionId}:`
  for (const [rid, meta] of idx) {
    if (!rid.startsWith(prefix)) continue
    // rid format: connId:node:type:vmid → split on ':' from the end
    const lastColon = rid.lastIndexOf(':')
    if (lastColon < 0) continue
    if (rid.slice(lastColon + 1) === target) return meta
  }
  return null
}
