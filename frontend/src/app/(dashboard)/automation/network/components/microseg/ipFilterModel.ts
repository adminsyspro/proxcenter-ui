// The IP filter of the zone members, as plain data: what the admin set per guest (the `guest_filters` of the policy,
// always written as a whole list), what a guest's row of GET /ipfilter says, and the addresses typed in the dialog.

import { clusterGuestId } from '@/lib/microseg/pendingChanges'
import type { GuestIPFilter, GuestType, IPFilterGuest, IPFilterHeld, MicrosegIPFilter, MicrosegPolicy } from '@/lib/microseg/types'

import { isCidr, isIpAddress } from './zoneForm'

/** A guest the filter is set for: its cluster, type and VMID (its name is only kept for the reader of the list). */
export type FilterGuestRef = { connectionId: string; type: GuestType; vmid: number; name?: string }

/** False on an orchestrator that does not know the IP filter: nothing of it is shown then. */
export function ipFilterAvailable(policy: Pick<MicrosegPolicy, 'policy'> | null | undefined): boolean {
  return typeof policy?.policy?.ip_filter === 'boolean'
}

/** The per-guest settings of the draft; an orchestrator that sends none has none. */
export function guestFiltersOf(policy: Pick<MicrosegPolicy, 'policy'>): GuestIPFilter[] {
  return Array.isArray(policy.policy.guest_filters) ? policy.policy.guest_filters : []
}

/** An entry without a cluster is of the cluster the policy was read through. */
const sameGuest = (f: GuestIPFilter, guest: FilterGuestRef, tabConnection: string) =>
  (f.connection_id || tabConnection) === guest.connectionId && f.type === guest.type && f.vmid === guest.vmid

/** What the draft holds for a guest, if anything. */
export function guestFilterOf(filters: readonly GuestIPFilter[], guest: FilterGuestRef, tabConnection: string): GuestIPFilter | undefined {
  return filters.find(f => sameGuest(f, guest, tabConnection))
}

export type GuestFilterPatch = { disabled?: boolean; extra?: string[] }

/** An entry as it is sent: no `disabled: false`, no empty `extra`; null when nothing is left of it. */
function cleaned(entry: GuestIPFilter): GuestIPFilter | null {
  const { disabled, extra, ...rest } = entry
  const kept: GuestIPFilter = { ...rest }
  if (disabled) kept.disabled = true
  if (extra && extra.length > 0) kept.extra = extra
  return kept.disabled || kept.extra ? kept : null
}

/**
 * The whole list with the entry of `guest` changed by `patch`: the other entries are kept as they are (their cluster
 * included), the guest's one keeps what the patch does not name, a new one takes the guest's cluster. An entry left
 * with neither `disabled` nor `extra` leaves the list (the server would drop it).
 */
export function withGuestFilter(filters: readonly GuestIPFilter[], guest: FilterGuestRef, patch: GuestFilterPatch, tabConnection: string): GuestIPFilter[] {
  const current = guestFilterOf(filters, guest, tabConnection)
  const base: GuestIPFilter = current ?? { connection_id: guest.connectionId, type: guest.type, vmid: guest.vmid, ...(guest.name ? { name: guest.name } : {}) }
  const next = cleaned({ ...base, ...patch })
  const others = filters.filter(f => f !== current)
  if (!next) return others
  // The changed entry stays where it was; a new one goes last.
  return current ? filters.map(f => (f === current ? next : f)) : [...others, next]
}

/** The list with `addr` added to the allowed addresses of `guest` (once). */
export function withAllowedAddress(filters: readonly GuestIPFilter[], guest: FilterGuestRef, addr: string, tabConnection: string): GuestIPFilter[] {
  const extra = guestFilterOf(filters, guest, tabConnection)?.extra ?? []
  return withGuestFilter(filters, guest, { extra: extra.includes(addr) ? extra : [...extra, addr] }, tabConnection)
}

/** The addresses typed in the dialog: one per line (commas and spaces split too), each once. */
export function parseAddresses(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).filter(Boolean))]
}

/** The first entry that is neither an IPv4 or IPv6 address nor a CIDR, null when every one is (the server judges the width). */
export function invalidAddress(addresses: readonly string[]): string | null {
  return addresses.find(a => !isIpAddress(a) && !isCidr(a)) ?? null
}

/** The entries the engine adds to every list: DHCP discovery (0.0.0.0) and the link-local address of the NIC. */
export function isTechnicalAddress(addr: string): boolean {
  return addr === '0.0.0.0' || /^fe[89ab][0-9a-f]:/i.test(addr)
}

/** The addresses of a NIC, the guest's own first and the technical ones after. */
export function splitAddresses(addresses: readonly string[]): { own: string[]; technical: string[] } {
  return { own: addresses.filter(a => !isTechnicalAddress(a)), technical: addresses.filter(isTechnicalAddress) }
}

/** How many addresses a guest may send from, the technical ones left out. */
export function allowedCount(guest: Pick<IPFilterGuest, 'nics'>): number {
  return new Set(Object.values(guest.nics ?? {}).flat().filter(a => !isTechnicalAddress(a))).size
}

/** The NIC keys in their natural order (net0, net1, net10). */
export function nicKeys(guest: Pick<IPFilterGuest, 'nics'>): string[] {
  return Object.keys(guest.nics ?? {}).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
}

/** The row of a guest in the answer of its cluster. */
export function ipFilterRow(data: Pick<MicrosegIPFilter, 'guests'> | undefined, guest: { type: string; vmid: number }): IPFilterGuest | undefined {
  return data?.guests.find(g => g.type === guest.type && g.vmid === guest.vmid)
}

/** The rows of a cluster by guest (`guestId`: cluster, type and VMID). */
export function ipFilterByGuest(byCluster: Readonly<Record<string, MicrosegIPFilter | undefined>>): Map<string, IPFilterGuest> {
  const out = new Map<string, IPFilterGuest>()
  for (const [id, data] of Object.entries(byCluster)) {
    // Until the first full run the rows mean nothing; a policy that does not filter marks nobody.
    if (!data?.enabled || !data.computed) continue
    for (const g of data.guests) out.set(clusterGuestId(id, g.type, g.vmid), g)
  }
  return out
}

export type GuestFilterState = 'loading' | 'waiting' | 'off' | 'notMember' | 'filtered' | 'willFilter' | 'excluded' | 'manual' | 'noAddress'

/**
 * What the state line of a guest says. `policyOn` is the switch of the draft: with it off, a guest Proxmox does not
 * filter is simply not filtered. The admin's choice and what prevents the filter come before "filtered".
 */
export function guestFilterState(data: Pick<MicrosegIPFilter, 'computed'> | undefined, row: IPFilterGuest | undefined, policyOn: boolean): GuestFilterState {
  if (!data) return 'loading'
  if (!data.computed) return 'waiting'
  if (!row) return 'notMember'
  if (!policyOn && !row.applied) return 'off'
  if (row.mode === 'excluded') return 'excluded'
  if (row.mode === 'manual') return 'manual'
  if (row.mode === 'no_address') return 'noAddress'
  return row.applied ? 'filtered' : 'willFilter'
}

/** The state of a row in a list of members, where every row is a member of a computed answer. */
export type RowState = Exclude<GuestFilterState, 'loading' | 'waiting' | 'off' | 'notMember'>

export function rowState(row: IPFilterGuest): RowState {
  return guestFilterState({ computed: true }, row, true) as RowState
}

const some = (list: readonly unknown[] | null | undefined) => !!list && list.length > 0

/** A member the admin should look at: not filtered for lack of an address, a list made by hand, an address held back or a source the lists would drop. */
export function needsAttention(row: IPFilterGuest): boolean {
  // A NIC on DHCP counts too: an address that changes is cut until the next address collection.
  return row.mode === 'no_address' || row.mode === 'manual' || some(row.held) || some(row.unknown) || (row.mode === 'on' && some(row.dhcp))
}

/** The members ready to be filtered, and those to look at; a member left out by the admin is neither. */
export function ipFilterCounts(guests: readonly IPFilterGuest[]): { members: number; ready: number; attention: number } {
  const attention = guests.filter(needsAttention).length
  const ready = guests.filter(g => g.mode === 'on' && !needsAttention(g)).length
  return { members: guests.length, ready, attention }
}

/** The i18n key (under microsegPilot.ipFilter.held) of why an address was not added. */
export function heldKey(held: Pick<IPFilterHeld, 'reason' | 'by'>): 'guest' | 'guestUnnamed' | 'peer' | 'source' | 'other' {
  if (held.reason === 'guest') return held.by ? 'guest' : 'guestUnnamed'
  if (held.reason === 'peer') return 'peer'
  return held.reason === 'source' && held.by ? 'source' : 'other'
}
