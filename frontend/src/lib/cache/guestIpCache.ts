/**
 * In-memory index of the LIVE addresses of guests (QEMU guest agent, LXC
 * /interfaces), keyed by connection then `type/vmid`. Feeds the IP and MAC
 * search of the command palette (#223, #861).
 *
 * Filled in the background by lib/inventory/guestIpIndex.ts: a lookup never
 * waits on PVE. An entry deliberately outlives the guest's uptime: a stopped
 * VM keeps its last known addresses flagged `stale`, so it can still be found
 * by the IP it had (#223, point 3), until the retention window runs out.
 *
 * Uses globalThis to survive Next.js hot-reload, like the sibling caches.
 */

export type GuestIpEntry = {
  ips: string[]
  macs: string[]
  /** Last time the guest itself answered. */
  seenAt: number
  /** True once a refresh could not re-confirm the entry (stopped guest, agent down). */
  stale: boolean
}

type ConnectionIndex = {
  entries: Map<string, GuestIpEntry>
  refreshedAt: number
}

const CACHE_KEY = "__proxcenter_guest_ip_index__" as const
const INFLIGHT_KEY = "__proxcenter_guest_ip_inflight__" as const
const GENERATION_KEY = "__proxcenter_guest_ip_generation__" as const

/** A connection is re-probed at most this often, and only while /api/v1/vms is in use. */
export const GUEST_IP_REFRESH_MS = 5 * 60 * 1_000

/** A stale entry is dropped after this long without a live answer. */
export const GUEST_IP_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000

function getStore(): Map<string, ConnectionIndex> {
  if (!(globalThis as any)[CACHE_KEY]) {
    ;(globalThis as any)[CACHE_KEY] = new Map<string, ConnectionIndex>()
  }
  return (globalThis as any)[CACHE_KEY]
}

function getInflightStore(): Map<string, Promise<void>> {
  if (!(globalThis as any)[INFLIGHT_KEY]) {
    ;(globalThis as any)[INFLIGHT_KEY] = new Map<string, Promise<void>>()
  }
  return (globalThis as any)[INFLIGHT_KEY]
}

function getGenerationStore(): Map<string, number> {
  if (!(globalThis as any)[GENERATION_KEY]) {
    ;(globalThis as any)[GENERATION_KEY] = new Map<string, number>()
  }
  return (globalThis as any)[GENERATION_KEY]
}

export function guestKey(type: string, vmid: string | number): string {
  return `${type}/${vmid}`
}

/** The whole index of a connection, or null when it was never built. */
export function getGuestIpIndex(connId: string): Map<string, GuestIpEntry> | null {
  return getStore().get(connId)?.entries ?? null
}

export function getGuestIpEntry(connId: string, key: string): GuestIpEntry | null {
  return getStore().get(connId)?.entries.get(key) ?? null
}

/** True when the connection was never indexed or its index is older than GUEST_IP_REFRESH_MS. */
export function isGuestIpIndexDue(connId: string, now = Date.now()): boolean {
  const index = getStore().get(connId)
  return !index || now - index.refreshedAt >= GUEST_IP_REFRESH_MS
}

export function setGuestIpIndex(connId: string, entries: Map<string, GuestIpEntry>, now = Date.now()): void {
  getStore().set(connId, { entries, refreshedAt: now })
}

export function getGuestIpInflight(connId: string): Promise<void> | null {
  return getInflightStore().get(connId) ?? null
}

export function setGuestIpInflight(connId: string, p: Promise<void> | null): void {
  if (p === null) getInflightStore().delete(connId)
  else getInflightStore().set(connId, p)
}

/**
 * Bumped by every invalidation of a connection. A refresh that started before
 * the bump must not write its (now foreign) result back: it compares the
 * generation it captured at start with the current one before storing.
 */
export function getGuestIpGeneration(connId: string): number {
  return getGenerationStore().get(connId) ?? 0
}

/**
 * Drop the index of one connection (deleted, or re-pointed to another
 * cluster so its `type/vmid` keys would name other guests), or all of them.
 */
export function invalidateGuestIpIndex(connId?: string): void {
  const generations = getGenerationStore()
  if (connId) {
    getStore().delete(connId)
    generations.set(connId, getGuestIpGeneration(connId) + 1)
  } else {
    for (const id of getStore().keys()) generations.set(id, getGuestIpGeneration(id) + 1)
    getStore().clear()
  }
}

/** Forget one guest (destroyed): a later guest reusing its vmid must not inherit its addresses. */
export function deleteGuestIpEntry(connId: string, key: string): void {
  getStore().get(connId)?.entries.delete(key)
}

export function __resetGuestIpIndexForTests(): void {
  getStore().clear()
  getInflightStore().clear()
  getGenerationStore().clear()
}
