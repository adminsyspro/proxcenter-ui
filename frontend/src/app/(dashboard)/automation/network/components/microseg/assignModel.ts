import { pendingByGuest } from '@/lib/microseg/pendingChanges'
import type { GuestRef, MembersInput, MicrosegZone, PendingMember } from '@/lib/microseg/types'

import { byGuestName, guestId, memberChange, type MemberChange, type PolicyGuest } from './zoneModel'

/** Most guests one POST /members accepts. */
export const MAX_ASSIGN = 1000

export const GUESTS_PAGE_SIZE = 25

export type AssignRow = {
  /** The guest's `guestId` (cluster, type, VMID): selections and React keys use it. */
  key: string
  guest: PolicyGuest
  ref: GuestRef
  /** Already tagged with the zone ("tag") or queued for it ("pending"): nothing to assign. */
  member: 'tag' | 'pending' | null
  /** Tagged with the zone but queued for removal or for another zone: selecting it again clears that queued change. */
  change?: MemberChange
  /** Names of the other zones the guest carries a tag of, or is queued for: assigning MOVES it. */
  otherZones: string[]
}

/**
 * One row per guest, by name, with its membership of `zone` and the other zones it is in (tag or queued). A pending
 * member counts only for the guest of its own cluster (`connection_id` + type + VMID).
 */
export function assignRows(
  zone: MicrosegZone,
  zones: MicrosegZone[],
  tagPrefix: string,
  guests: PolicyGuest[],
  pending: PendingMember[],
): AssignRow[] {
  // PVE lowercases tags: tags are compared lowercased, like zoneMembers does.
  const tagOf = (z: MicrosegZone) => `${tagPrefix}${z.name}`.toLowerCase()
  const queuedByGuest = pendingByGuest(pending)
  const zoneById = new Map(zones.map(z => [z.id, z]))

  return [...guests].sort(byGuestName).map(guest => {
    const tags = new Set(guest.tags.map(tag => tag.toLowerCase()))
    const key = guestId(guest)
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

/** A member the dialog can take out of the zone by unticking it: tagged with no queued change, or queued for the zone. */
export const isRemovable = (row: AssignRow) => row.member !== null && row.change === undefined

/**
 * The requests that take unticked members out, for one cluster and in this order: the tagged ones are queued for no
 * zone (the next apply removes their tag), the ones only queued for the zone are forgotten from the draft. Each takes
 * the draft version the previous request answered.
 */
export function removalBodies(removed: AssignRow[]): Array<(version: number) => MembersInput> {
  const tagged = removed.filter(r => r.member === 'tag').map(r => r.ref)
  const queued = removed.filter(r => r.member === 'pending').map(r => ({ type: r.ref.type, vmid: r.ref.vmid }))
  return [
    ...(tagged.length > 0 ? [(version: number): MembersInput => ({ version, zone_id: '', guests: tagged })] : []),
    ...(queued.length > 0 ? [(version: number): MembersInput => ({ version, clear: queued })] : []),
  ]
}

/**
 * The request of the dialog: the guests to queue for the zone, and the members whose queued removal or move is taken
 * back, cleared rather than queued again for their own zone (the draft then loses that change).
 */
export function membersBody(version: number, zoneId: string, chosen: AssignRow[]): MembersInput {
  const clear = chosen.filter(r => r.change).map(r => ({ type: r.ref.type, vmid: r.ref.vmid }))
  const guests = chosen.filter(r => !r.change).map(r => r.ref)
  if (guests.length === 0) return { version, clear }
  return clear.length > 0 ? { version, zone_id: zoneId, guests, clear } : { version, zone_id: zoneId, guests }
}

/**
 * The selection split by cluster, by connection ID: `POST /members` writes the rows of its URL's cluster only, so the
 * dialog sends one request per cluster concerned, through that cluster.
 */
export function chosenByCluster(chosen: readonly AssignRow[]): [string, AssignRow[]][] {
  const groups = new Map<string, AssignRow[]>()
  for (const row of chosen) {
    const list = groups.get(row.guest.connectionId)
    if (list) list.push(row)
    else groups.set(row.guest.connectionId, [row])
  }
  return [...groups].sort(([a], [b]) => (a < b ? -1 : Number(a > b)))
}
