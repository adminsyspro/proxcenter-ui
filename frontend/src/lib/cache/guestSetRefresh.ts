/**
 * Cache upkeep after a ProxCenter action that adds guests to a connection or
 * moves them (create, clone, restore, deploy, migrate), roadmap#192.
 *
 * Proxmox writes the config of a new guest, locked, before its task starts,
 * so one read of /cluster/resources right after the call already lists it.
 * That read patches the connection in every cached inventory: one PVE call,
 * none when no cached inventory holds the connection, where the invalidation
 * it replaces cost a full fan-out per tenant and vDC context on the next read.
 * What changes when the task ends (lock released, migrated guest on its new
 * node) is caught by the inventory poller, which patches the same way.
 */
import { safeLog } from '@/lib/log/sanitize'
import { pveFetch, type ProxmoxClientOptions } from '@/lib/proxmox/client'

import { clearGuestTombstone, hasCachedConnection, reconcileCachedGuests, type ResourceGuestRow } from './inventoryCache'

export async function refreshCachedGuests(
  connId: string,
  conn: ProxmoxClientOptions,
  created?: { type: string; vmid: string | number },
): Promise<void> {
  // A vmid ProxCenter destroyed a moment ago and now reuses is a new guest.
  if (created) clearGuestTombstone(connId, created.type, created.vmid)
  if (!hasCachedConnection(connId)) return
  try {
    const rows = await pveFetch<ResourceGuestRow[]>(conn, '/cluster/resources?type=vm')
    if (Array.isArray(rows)) reconcileCachedGuests(connId, rows)
  } catch (e: any) {
    // The action itself succeeded; the cache falls back on the poller and its TTL.
    console.warn(`[inventory-cache] Guest refresh of connection ${safeLog(connId)} failed: ${safeLog(e?.message)}`)
  }
}
