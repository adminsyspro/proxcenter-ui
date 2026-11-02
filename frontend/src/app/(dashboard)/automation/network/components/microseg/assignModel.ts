import type { GuestRef, MicrosegZone, PendingMember } from '@/lib/microseg/types'

import { guestKey, memberChange, type MemberChange, type PolicyGuest } from './zoneModel'

/** Most guests one POST /members accepts. */
export const MAX_ASSIGN = 1000

export const GUESTS_PAGE_SIZE = 25

export type AssignRow = {
  key: string
  guest: PolicyGuest
  ref: GuestRef
  /** Already tagged with the zone ("tag") or queued for it ("pending"): nothing to assign. */
  member: 'tag' | 'pending' | null
  /** Tagged with the zone but queued for removal or for another zone: selecting it again re-queues it for this zone. */
  change?: MemberChange
  /** Names of the other zones the guest carries a tag of, or is queued for: assigning MOVES it. */
  otherZones: string[]
}

/** One row per guest, with its membership of `zone` and the other zones it is in (tag or queued). */
export function assignRows(
  zone: MicrosegZone,
  zones: MicrosegZone[],
  tagPrefix: string,
  guests: PolicyGuest[],
  pending: PendingMember[],
): AssignRow[] {
  // PVE lowercases tags: tags are compared lowercased, like zoneMembers does.
  const tagOf = (z: MicrosegZone) => `${tagPrefix}${z.name}`.toLowerCase()
  const queuedByGuest = new Map(pending.map(p => [guestKey(p), p]))
  const zoneById = new Map(zones.map(z => [z.id, z]))

  return guests.map(guest => {
    const tags = new Set(guest.tags.map(tag => tag.toLowerCase()))
    const key = guestKey(guest)
    const queued = queuedByGuest.get(key)
    const queuedFor = queued?.zone_id
    const others = zones.filter(z => z.id !== zone.id && tags.has(tagOf(z))).map(z => z.name)
    const queuedElsewhere = queuedFor && queuedFor !== zone.id ? zoneById.get(queuedFor)?.name : undefined
    if (queuedElsewhere && !others.includes(queuedElsewhere)) others.push(queuedElsewhere)
    const member = tags.has(tagOf(zone)) ? 'tag' : queuedFor === zone.id ? 'pending' : null
    const change = member === 'tag' ? memberChange(zone.id, queued, zoneById) : undefined
    return { key, guest, ref: { node: guest.node, type: guest.type, vmid: guest.vmid }, member, change, otherZones: others }
  })
}

/** Search by name or vmid, case-insensitive. */
export function filterRows(rows: AssignRow[], search: string): AssignRow[] {
  const needle = search.trim().toLowerCase()
  if (!needle) return rows
  return rows.filter(r => r.guest.name.toLowerCase().includes(needle) || String(r.guest.vmid).includes(needle))
}

/** A row the admin can tick: not a member yet, or a member whose removal / move is queued. */
export const isSelectable = (row: AssignRow) => row.member === null || row.change !== undefined
