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
// The probe is a protected PVE call: it goes through the node's pvedaemon
// slots, and an agent that did not answer is left alone (roadmap#179).
//
// UA52: only QEMU guests are probed (agent network-get-interfaces), each one at
// most once per GUEST_IP_PROBE_TTL_MS, through the connection's pool (4 in
// flight, 2 per node, shared with the config reads) and a gate (no probe starts
// after GUEST_IP_REFRESH_BUDGET_MS or once one was slow or timed out). A
// container is never probed: its addresses come from its config (`ip=`).
import { callGuestAgent } from "@/lib/proxmox/guestAgentCall"
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

import { mapWithConcurrency } from "./concurrency"
import { createCallGate, POOL_GLOBAL_CONCURRENCY, withConnectionSlot } from "./connectionPool"
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

/** A guest's live addresses are asked again at most this often (UA52). */
export const GUEST_IP_PROBE_TTL_MS = 15 * 60 * 1_000
/** No probe of a refresh starts after this. */
export const GUEST_IP_REFRESH_BUDGET_MS = 60_000

/** The live endpoint worth calling for this guest right now, or null: a running QEMU guest with the agent flag. */
export function liveAddressesPath(g: IndexableGuest): string | null {
  if (g.status !== "running" || g.type !== "qemu" || !g.agentEnabled) return null
  return `/nodes/${encodeURIComponent(g.node)}/qemu/${encodeURIComponent(String(g.vmid))}/agent/network-get-interfaces`
}

type ProbeMark = { at: number; generation: number }

const PROBED_KEY = "__proxcenter_guest_ip_probed__" as const

/** When each guest was last probed, keyed by connection and type/vmid, with the index generation of the time. */
function probed(): Map<string, ProbeMark> {
  const g = globalThis as any
  if (!g[PROBED_KEY]) g[PROBED_KEY] = new Map<string, ProbeMark>()
  return g[PROBED_KEY]
}

/** Test seam. */
export function resetGuestIpProbeTimes(): void {
  probed().clear()
}

/** Probed less than GUEST_IP_PROBE_TTL_MS ago, in the index's current generation (an invalidation asks again). */
function probedRecently(connId: string, key: string, generation: number, now: number): boolean {
  const mark = probed().get(`${connId}::${key}`)
  return !!mark && mark.generation === generation && now - mark.at < GUEST_IP_PROBE_TTL_MS
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

  const gate = createCallGate({ deadline: Date.now() + GUEST_IP_REFRESH_BUDGET_MS })
  const conn = { ...connData, id: connId }

  const results = await mapWithConcurrency(guests, POOL_GLOBAL_CONCURRENCY, async (g): Promise<[string, GuestIpEntry | null]> => {
    const key = guestKey(g.type, g.vmid)
    const prev = previous.get(key)
    if (!liveAddressesPath(g)) return [key, carryOver(prev, now)]
    // Asked less than 15 min ago: what it said then still stands.
    if (probedRecently(connId, key, generation, now)) return [key, prev ?? null]
    const answer = await withConnectionSlot(connId, g.node, () => gate.run(() => {
      probed().set(`${connId}::${key}`, { at: now, generation })
      return callGuestAgent<unknown>(conn, g.node, g.vmid, "network-get-interfaces")
    }))
    const live = extractLiveAddresses(answer)
    // No answer, or one without a single routable address (DHCP still
    // pending), is not a new truth: keep what we knew rather than erase it.
    if (live.ips.length === 0) return [key, carryOver(prev, now)]
    return [key, { ips: live.ips, macs: live.macs, seenAt: now, stale: false }]
  })

  // Invalidated while we were probing (connection deleted or re-pointed):
  // this result describes guests that no longer belong to the key space.
  if (getGuestIpGeneration(connId) !== generation) return

  // A guest gone from the list (destroyed, moved away) is asked afresh if it comes back.
  const listed = new Set(guests.map(g => `${connId}::${guestKey(g.type, g.vmid)}`))
  for (const mark of probed().keys()) if (mark.startsWith(`${connId}::`) && !listed.has(mark)) probed().delete(mark)

  const next = new Map<string, GuestIpEntry>()
  for (const [key, entry] of results) {
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
  if (getGuestIpInflight(connId) !== null) return firstBuild
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
