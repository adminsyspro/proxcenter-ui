import type { GuestRef, MicrosegFlow, MicrosegSuggestion, MicrosegZone, PendingMember } from '@/lib/microseg/types'

/** A guest of the connection, as /api/v1/vms?connId= lists it. */
export type PolicyGuest = {
  vmid: number
  name: string
  node: string
  type: 'qemu' | 'lxc'
  status: string
  tags: string[]
}

/** A change queued for a guest that still carries the tag of the zone: its removal, or its move to another zone. */
export type MemberChange = { kind: 'removal' } | { kind: 'move'; zoneName: string }

export type ZoneMember = {
  ref: GuestRef
  /** Null when the guest is not in the inventory (deleted, or not listed yet). */
  guest: PolicyGuest | null
  /** Queued for the zone but not tagged yet: the next apply tags it. */
  pending: boolean
  /** Tagged with the zone, and a pending member says the next apply removes it or moves it elsewhere. */
  change?: MemberChange
}

/** Guests are identified by type and vmid, like the backend does (the node changes when a guest migrates). */
export const guestKey = (g: { type: string; vmid: number }) => `${g.type}/${g.vmid}`

/** The change a pending member queues for a guest tagged with `zoneId`, or undefined when it queues none. */
export function memberChange(zoneId: string, queued: PendingMember | undefined, zonesById: Map<string, MicrosegZone>): MemberChange | undefined {
  if (!queued || queued.zone_id === zoneId) return undefined
  if (queued.zone_id === '') return { kind: 'removal' }
  const target = zonesById.get(queued.zone_id)
  return target ? { kind: 'move', zoneName: target.name } : undefined
}

/**
 * Members of a zone: the guests that carry the tag `<tag_prefix><zone name>`
 * (with the change a pending member queues for them), plus the pending members
 * queued for the zone that are not tagged yet.
 */
export function zoneMembers(
  zone: MicrosegZone,
  tagPrefix: string,
  guests: PolicyGuest[],
  pending: PendingMember[],
  zones: MicrosegZone[] = [],
): ZoneMember[] {
  // PVE lowercases tags; the prefix and the zone name are compared the same way.
  const tag = `${tagPrefix}${zone.name}`.toLowerCase()
  const queuedByGuest = new Map(pending.map(p => [guestKey(p), p]))
  const zonesById = new Map(zones.map(z => [z.id, z]))
  const tagged: ZoneMember[] = guests
    .filter(g => g.tags.some(candidate => candidate.toLowerCase() === tag))
    .map(g => ({
      ref: { node: g.node, type: g.type, vmid: g.vmid },
      guest: g,
      pending: false,
      change: memberChange(zone.id, queuedByGuest.get(guestKey(g)), zonesById),
    }))
  const taggedKeys = new Set(tagged.map(m => guestKey(m.ref)))
  const guestsByKey = new Map(guests.map(g => [guestKey(g), g]))

  const queued: ZoneMember[] = []
  for (const p of pending) {
    if (p.zone_id !== zone.id || taggedKeys.has(guestKey(p))) continue
    queued.push({ ref: { node: p.node, type: p.type, vmid: p.vmid }, guest: guestsByKey.get(guestKey(p)) ?? null, pending: true })
  }
  return [...tagged, ...queued]
}

export function flowsOfZone(zoneId: string, flows: MicrosegFlow[]): { incoming: MicrosegFlow[]; outgoing: MicrosegFlow[] } {
  return {
    incoming: flows.filter(f => f.dst_zone_id === zoneId),
    outgoing: flows.filter(f => f.src_zone_id === zoneId),
  }
}

const DEFAULT_READY_AFTER_HOURS = 24

/**
 * "Ready" to be enforced: observed for at least `ready_after_hours` and no
 * pending would-block suggestion seen inside that window. An indicator, not a
 * lock: the UI asks for the zone name to go ahead when it is not ready.
 * `pending` holds the pending would-block suggestions of the zone.
 */
export function isZoneReady(
  zone: Pick<MicrosegZone, 'state' | 'observe_since'>,
  pending: Pick<MicrosegSuggestion, 'last_seen'>[],
  readyAfterHours: number | undefined,
  now: number,
): boolean {
  const windowMs = (readyAfterHours && readyAfterHours > 0 ? readyAfterHours : DEFAULT_READY_AFTER_HOURS) * 3600_000
  const since = zone.observe_since ? Date.parse(zone.observe_since) : NaN
  if (Number.isNaN(since) || now - since < windowMs) return false
  return !pending.some(s => now - Date.parse(s.last_seen) < windowMs)
}
