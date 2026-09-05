// Background index of the live addresses of guests, and its merge onto the
// /api/v1/vms payload (#223, #861).
//
// Why a background index and not a probe per request: the guest agent call
// costs about 7x a /config read and there is one per running VM, so probing
// on every palette open would be exactly the load the #223 thread worried
// about. Here /api/v1/vms only READS the index and, at most every
// GUEST_IP_REFRESH_MS per connection, kicks off one bounded-concurrency
// refresh that nobody waits for. A stopped guest keeps its last known
// addresses flagged stale, so it can still be found by its former IP.
import { pveFetch } from "@/lib/proxmox/client"
import {
  GUEST_IP_RETENTION_MS,
  getGuestIpEntry,
  getGuestIpGeneration,
  getGuestIpIndex,
  getGuestIpInflight,
  guestKey,
  isGuestIpIndexDue,
  setGuestIpIndex,
  setGuestIpInflight,
  type GuestIpEntry,
} from "@/lib/cache/guestIpCache"

import { mapWithConcurrency, PVEPROXY_CONCURRENCY } from "./concurrency"
import { extractLiveAddresses } from "./guestNetIdentity"

export type IndexableGuest = {
  vmid: string | number
  node: string
  type: string
  status: string
  /** From the config pass: the agent probe is only worth it when the admin ticked the box. */
  agentEnabled?: boolean
  configIps?: string[]
  macs?: string[]
}

export type WithGuestIps<T> = T & {
  /** Config-pinned addresses first, then the last known live ones. */
  ips: string[]
  macs: string[]
  /**
   * The subset of `ips` that is a last known live address the guest could
   * not re-confirm (stopped, agent down). Per address, not per guest: a
   * config-pinned IP on the same guest is current and must not be flagged.
   */
  staleIps: string[]
}

/** The live endpoint worth calling for this guest right now, or null. */
export function liveAddressesPath(g: IndexableGuest): string | null {
  if (g.status !== "running") return null
  const node = encodeURIComponent(g.node)
  const vmid = encodeURIComponent(String(g.vmid))
  if (g.type === "lxc") return `/nodes/${node}/lxc/${vmid}/interfaces`
  if (g.agentEnabled) return `/nodes/${node}/qemu/${vmid}/agent/network-get-interfaces`
  return null
}

/** Keep the previous entry as stale, or drop it once the retention window is over. */
function carryOver(prev: GuestIpEntry | undefined, now: number): GuestIpEntry | null {
  if (!prev) return null
  if (now - prev.seenAt > GUEST_IP_RETENTION_MS) return null
  return prev.stale ? prev : { ...prev, stale: true }
}

/**
 * Probe every running guest of one connection and rebuild its index. A guest
 * that cannot be probed (stopped, agent off or unresponsive, transient error)
 * carries its previous entry over as stale. Never throws.
 */
export async function refreshGuestIpIndex(
  connId: string,
  connData: any,
  guests: IndexableGuest[],
  now = Date.now(),
): Promise<void> {
  const previous = getGuestIpIndex(connId) ?? new Map<string, GuestIpEntry>()
  const generation = getGuestIpGeneration(connId)

  const probed = await mapWithConcurrency(guests, PVEPROXY_CONCURRENCY, async (g): Promise<[string, GuestIpEntry | null]> => {
    const key = guestKey(g.type, g.vmid)
    const prev = previous.get(key)
    const path = liveAddressesPath(g)
    if (!path) return [key, carryOver(prev, now)]
    try {
      const live = extractLiveAddresses(await pveFetch<unknown>(connData, path))
      // An answer without a single routable address (DHCP still pending) is
      // not a new truth: keep what we knew rather than erase it.
      if (live.ips.length === 0) return [key, carryOver(prev, now)]
      return [key, { ips: live.ips, macs: live.macs, seenAt: now, stale: false }]
    } catch {
      return [key, carryOver(prev, now)]
    }
  })

  // Invalidated while we were probing (connection deleted or re-pointed):
  // this result describes guests that no longer belong to the key space.
  if (getGuestIpGeneration(connId) !== generation) return

  const next = new Map<string, GuestIpEntry>()
  for (const [key, entry] of probed) {
    if (entry) next.set(key, entry)
  }
  setGuestIpIndex(connId, next, now)
}

/**
 * Fire-and-forget refresh when the connection's index is due, one at a time
 * per connection. Returns true while the index is being built for the FIRST
 * time, so a caller can tell the UI to come back in a moment.
 */
export function scheduleGuestIpRefresh(connId: string, connData: any, guests: IndexableGuest[]): boolean {
  const firstBuild = getGuestIpIndex(connId) === null
  if (getGuestIpInflight(connId)) return firstBuild
  if (!isGuestIpIndexDue(connId)) return false

  const run = refreshGuestIpIndex(connId, connData, guests)
    .catch((e: any) => console.error(`[guest-ip-index] refresh failed for ${connId}:`, e?.message))
    .finally(() => setGuestIpInflight(connId, null))
  setGuestIpInflight(connId, run)
  return firstBuild
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)]
}

/**
 * Merge config-pinned and last known live addresses onto each guest, then
 * schedule a background refresh when the connection's index is due. Pure
 * read otherwise: this never awaits PVE.
 *
 * `refresh: false` when the caller's guest enumeration failed: an empty or
 * partial list must not be indexed as the new truth, that would erase the
 * last known addresses and freeze the empty result for the whole TTL.
 */
export function attachGuestIps<T extends IndexableGuest>(
  connId: string,
  connData: any,
  guests: T[],
  opts: { refresh?: boolean } = {},
): { vms: WithGuestIps<T>[]; warming: boolean } {
  const warming = opts.refresh === false ? false : scheduleGuestIpRefresh(connId, connData, guests)
  const vms = guests.map(g => {
    const live = getGuestIpEntry(connId, guestKey(g.type, g.vmid))
    return {
      ...g,
      ips: dedupe([...(g.configIps ?? []), ...(live?.ips ?? [])]),
      macs: dedupe([...(g.macs ?? []), ...(live?.macs ?? [])]),
      staleIps: live?.stale ? live.ips : [],
    }
  })
  return { vms, warming }
}
