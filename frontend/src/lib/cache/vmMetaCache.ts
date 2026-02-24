/**
 * Synchronous VM metadata index for tag/pool RBAC resolution.
 *
 * Builds a Map<resourceId, VmMeta> from the existing in-memory inventory
 * cache so that scopeMatches() can resolve tags/pool without async I/O.
 *
 * The index is lazily rebuilt every 30 seconds (piggybacks on inventory's 2-min TTL).
 * On cache miss (cold start), returns null → tag/pool scopes can't match → safe denial.
 */

import { getInventoryFromCache } from "./inventoryCache"

export interface VmMeta {
  tags: string[]
  pool?: string
}

let vmMetaIndex: Map<string, VmMeta> | null = null
let lastBuild = 0

function rebuildIndex(): void {
  const cache = getInventoryFromCache()
  if (cache.status === "miss") return

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

  vmMetaIndex = idx
  lastBuild = Date.now()
}

export function resolveVmMeta(resourceId: string): VmMeta | null {
  if (!vmMetaIndex || Date.now() - lastBuild > 30_000) {
    rebuildIndex()
  }
  return vmMetaIndex?.get(resourceId) ?? null
}
