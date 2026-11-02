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

export type ZoneMember = {
  ref: GuestRef
  /** Null when the guest is not in the inventory (deleted, or not listed yet). */
  guest: PolicyGuest | null
  /** Queued for the zone but not tagged yet: the next apply tags it. */
  pending: boolean
}

const sameGuest = (g: PolicyGuest, r: GuestRef) => g.vmid === r.vmid && g.node === r.node && g.type === r.type

/**
 * Members of a zone: the guests that carry the tag `<tag_prefix><zone name>`,
 * plus the pending members queued for the zone that are not tagged yet.
 */
export function zoneMembers(zone: MicrosegZone, tagPrefix: string, guests: PolicyGuest[], pending: PendingMember[]): ZoneMember[] {
  const tag = `${tagPrefix}${zone.name}`
  const tagged: ZoneMember[] = guests
    .filter(g => g.tags.includes(tag))
    .map(g => ({ ref: { node: g.node, type: g.type, vmid: g.vmid }, guest: g, pending: false }))

  const queued: ZoneMember[] = []
  for (const p of pending) {
    if (p.zone_id !== zone.id) continue
    const ref: GuestRef = { node: p.node, type: p.type, vmid: p.vmid }
    if (tagged.some(m => sameGuest(m.guest!, ref))) continue
    queued.push({ ref, guest: guests.find(g => sameGuest(g, ref)) ?? null, pending: true })
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
