/**
 * Resolve the set of VMIDs that belong to a tenant's vDC pools, by
 * querying PVE directly. Used by the alerts visibility filter, which
 * cannot rely on the in-memory inventory cache being warm (15min TTL,
 * tenant-scoped, populated only when the user visited /infrastructure
 * /inventory recently).
 *
 * Cached per tenant with a short TTL to amortize the PVE roundtrip.
 */

import { getVdcScope } from "@/lib/vdc/scope"
import { getVdcContext } from "@/lib/vdc/context"
import { getConnectionById } from "@/lib/connections/getConnection"
import { pveFetch } from "@/lib/proxmox/client"

interface CacheEntry {
  data: Map<string, Set<string>>
  expiry: number
}

const cache = new Map<string, CacheEntry>()
const TTL_MS = 60_000

/**
 * Returns `connectionId → Set<vmid>` for every VM in the tenant's
 * vDC pools. An empty map is returned for the provider tenant or any
 * tenant with no vDC scope.
 */
export async function getVdcVmidsByConnection(
  tenantId: string,
  opts?: { ignoreVdcContext?: boolean }
): Promise<Map<string, Set<string>>> {
  // Keyed per (tenant, vDC context): the scope below is context-narrowed, so
  // a VMID map warmed under context A must not serve the union view. Object
  // routes (alerts by id) pass ignoreVdcContext → union entry.
  //
  // NOTE: getVdcContext is resolved TWICE on a cache miss — once here for the
  // key, once more inside getVdcScope below to build the scope itself. Both
  // calls are absorbed by getVdcContext's own 5s validation memo (context.ts)
  // so they agree in practice. A straddle (cookie/DB state changing between
  // the two calls, right as the 5s memo expires) can mis-key this entry for
  // at most that window; it self-heals at this cache's own 60s TTL.
  const vdcContext = opts?.ignoreVdcContext ? null : await getVdcContext(tenantId)
  const key = `${tenantId}::${vdcContext ?? 'all'}`

  const now = Date.now()
  const cached = cache.get(key)
  if (cached && cached.expiry > now) return cached.data

  const vdcScope = await getVdcScope(tenantId, opts)
  const result = new Map<string, Set<string>>()
  if (!vdcScope) {
    cache.set(key, { data: result, expiry: now + TTL_MS })
    return result
  }

  await Promise.all(
    Array.from(vdcScope.poolsByConnection.entries()).map(async ([connId, pools]) => {
      const vmids = new Set<string>()
      try {
        const conn = await getConnectionById(connId)
        for (const poolName of pools) {
          try {
            const data = await pveFetch<any>(conn, `/pools/${encodeURIComponent(poolName)}`)
            const members: any[] = Array.isArray(data?.members) ? data.members : []
            for (const m of members) {
              if (m?.vmid != null) vmids.add(String(m.vmid))
            }
          } catch {
            // Single pool fetch failure shouldn't kill the whole resolution;
            // worst case we hide alerts on this pool until next refresh.
          }
        }
      } catch {
        // Connection lookup failed (e.g. credentials missing) — leave
        // vmids empty so the visibility filter denies on this connection.
      }
      result.set(connId, vmids)
    })
  )

  cache.set(key, { data: result, expiry: now + TTL_MS })
  return result
}

/** Manually invalidate the cache (e.g. after vDC mutations). */
export function clearVdcVmidsCache(tenantId?: string): void {
  if (tenantId) {
    // Keys are `${tenantId}::${vdcId | 'all'}` — purge every context entry.
    const prefix = `${tenantId}::`
    for (const key of cache.keys()) {
      if (key.startsWith(prefix)) cache.delete(key)
    }
  } else {
    cache.clear()
  }
}
