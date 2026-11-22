/**
 * The IP filter of the zone members as plain data: the whole list of per-guest settings a write sends, the addresses
 * typed in the dialog, and what a row of GET /ipfilter says of a guest.
 */

import { describe, expect, it } from 'vitest'

import type { GuestIPFilter, IPFilterGuest, MicrosegPolicy } from '@/lib/microseg/types'

import {
  allowedCount, guestFilterOf, guestFilterState, guestFiltersOf, heldKey, invalidAddress, ipFilterAvailable, ipFilterByGuest, ipFilterCounts, ipFilterRow,
  isTechnicalAddress, needsAttention, nicKeys, parseAddresses, rowState, splitAddresses, withAllowedAddress, withGuestFilter,
} from './ipFilterModel'

const row = (over: Partial<IPFilterGuest> = {}): IPFilterGuest => ({
  node: 'pve1', type: 'qemu', vmid: 100, name: 'web-1', zone: 'web', mode: 'on', applied: true, nics: { net0: ['0.0.0.0', '10.0.0.5', 'fe80::1'] },
  held: [], no_address: [], manual: [], dhcp: [], unknown: [], extra: [], ...over,
})

const policyWith = (record: Partial<MicrosegPolicy['policy']>) => ({ policy: record as MicrosegPolicy['policy'] })

const web1 = { connectionId: 'c1', type: 'qemu' as const, vmid: 100, name: 'web-1' }

describe('availability', () => {
  it('follows ip_filter of the policy: absent on an older orchestrator', () => {
    expect(ipFilterAvailable(policyWith({}))).toBe(false)
    expect(ipFilterAvailable(policyWith({ ip_filter: false }))).toBe(true)
    expect(ipFilterAvailable(policyWith({ ip_filter: true }))).toBe(true)
    expect(ipFilterAvailable(null)).toBe(false)
  })

  it('reads guest filters that are null or absent as none', () => {
    expect(guestFiltersOf(policyWith({ guest_filters: null }))).toEqual([])
    expect(guestFiltersOf(policyWith({}))).toEqual([])
    expect(guestFiltersOf(policyWith({ guest_filters: [{ type: 'qemu', vmid: 1, disabled: true }] }))).toHaveLength(1)
  })
})

describe('the whole list a write sends', () => {
  const others: GuestIPFilter[] = [
    { connection_id: 'c2', type: 'qemu', vmid: 100, name: 'other-cluster', disabled: true },
    { type: 'lxc', vmid: 100, name: 'a-container', extra: ['10.0.0.9'] },
  ]

  it('adds an entry for a new guest with its cluster and name, after the others left as they are', () => {
    expect(withGuestFilter(others, web1, { disabled: true }, 'c1')).toEqual([...others, { connection_id: 'c1', type: 'qemu', vmid: 100, name: 'web-1', disabled: true }])
  })

  it('replaces the entry of the guest in place, keeping what the patch does not name and its connection', () => {
    const list: GuestIPFilter[] = [others[0], { connection_id: 'c1', type: 'qemu', vmid: 100, name: 'web-1', disabled: true }, others[1]]
    expect(withGuestFilter(list, web1, { extra: ['10.0.0.7', 'fd00::/64'] }, 'c1')).toEqual([
      others[0], { connection_id: 'c1', type: 'qemu', vmid: 100, name: 'web-1', disabled: true, extra: ['10.0.0.7', 'fd00::/64'] }, others[1],
    ])
  })

  it('takes an entry without a cluster as one of the connection of the policy, and leaves it without one', () => {
    const list: GuestIPFilter[] = [{ type: 'qemu', vmid: 100, extra: ['10.0.0.7'] }]
    expect(guestFilterOf(list, web1, 'c1')).toBe(list[0])
    expect(guestFilterOf(list, { ...web1, connectionId: 'c2' }, 'c1')).toBeUndefined()
    expect(withGuestFilter(list, web1, { disabled: true }, 'c1')).toEqual([{ type: 'qemu', vmid: 100, extra: ['10.0.0.7'], disabled: true }])
  })

  it('drops an entry left with neither disabled nor extra', () => {
    const list: GuestIPFilter[] = [others[0], { connection_id: 'c1', type: 'qemu', vmid: 100, disabled: true }]
    expect(withGuestFilter(list, web1, { disabled: false }, 'c1')).toEqual([others[0]])
    expect(withGuestFilter(others, web1, { extra: [] }, 'c1')).toEqual(others)
  })

  it('adds an allowed address once', () => {
    const once = withAllowedAddress([], web1, '10.0.0.7', 'c1')
    expect(once).toEqual([{ connection_id: 'c1', type: 'qemu', vmid: 100, name: 'web-1', extra: ['10.0.0.7'] }])
    expect(withAllowedAddress(once, web1, '10.0.0.7', 'c1')).toEqual(once)
    expect(withAllowedAddress(once, web1, '10.0.0.8', 'c1')[0].extra).toEqual(['10.0.0.7', '10.0.0.8'])
  })
})

describe('the addresses typed', () => {
  it('are one per line, commas and spaces too, each once', () => {
    expect(parseAddresses('10.0.0.5\n10.0.0.0/24, fd00::1\n\n10.0.0.5 ')).toEqual(['10.0.0.5', '10.0.0.0/24', 'fd00::1'])
    expect(parseAddresses('  ')).toEqual([])
  })

  it('must be IPv4 or IPv6 addresses or CIDRs: the first that is not is named', () => {
    expect(invalidAddress(['10.0.0.5', '10.0.0.0/24', 'fd00::1', 'fd00::/64'])).toBeNull()
    expect(invalidAddress(['10.0.0.5', 'web-1', '300.1.1.1'])).toBe('web-1')
    expect(invalidAddress(['10.0.0.0/33'])).toBe('10.0.0.0/33')
    expect(invalidAddress(['10.0.0.5-10.0.0.9'])).toBe('10.0.0.5-10.0.0.9')
    expect(invalidAddress([])).toBeNull()
  })
})

describe('the addresses of a guest', () => {
  it('tells the technical entries (DHCP discovery, link-local) from its own', () => {
    expect(isTechnicalAddress('0.0.0.0')).toBe(true)
    expect(isTechnicalAddress('fe80::be24:11ff:fe00:1')).toBe(true)
    expect(isTechnicalAddress('FE80::1')).toBe(true)
    expect(isTechnicalAddress('10.0.0.5')).toBe(false)
    expect(isTechnicalAddress('fd00::1')).toBe(false)
    expect(splitAddresses(['0.0.0.0', '10.0.0.5', 'fe80::1', 'fd00::1'])).toEqual({ own: ['10.0.0.5', 'fd00::1'], technical: ['0.0.0.0', 'fe80::1'] })
  })

  it('counts its own addresses once over its NICs, and orders the NICs naturally', () => {
    const guest = row({ nics: { net10: ['10.0.2.5'], net0: ['0.0.0.0', '10.0.0.5', 'fe80::1'], net2: ['10.0.0.5', '10.0.1.5'] } })
    expect(allowedCount(guest)).toBe(3)
    expect(nicKeys(guest)).toEqual(['net0', 'net2', 'net10'])
    expect(allowedCount(row({ nics: {} }))).toBe(0)
  })
})

describe('the row of a guest', () => {
  const data = { enabled: true, computed: true, computed_at: null, guests: [row(), row({ type: 'lxc', vmid: 100, name: 'ct' })] }

  it('is found by type and VMID', () => {
    expect(ipFilterRow(data, { type: 'lxc', vmid: 100 })?.name).toBe('ct')
    expect(ipFilterRow(data, { type: 'qemu', vmid: 7 })).toBeUndefined()
    expect(ipFilterRow(undefined, { type: 'qemu', vmid: 100 })).toBeUndefined()
  })

  it('is listed by guest across the clusters, only for a policy that filters and has been computed', () => {
    const byGuest = ipFilterByGuest({ c1: data, c2: { ...data, enabled: false }, c3: { ...data, computed: false }, c4: undefined })
    expect([...byGuest.keys()]).toEqual(['c1/qemu/100', 'c1/lxc/100'])
  })
})

describe('the state of a guest', () => {
  const computed = { computed: true }

  it('waits for the answer, then for the first full check', () => {
    expect(guestFilterState(undefined, undefined, true)).toBe('loading')
    expect(guestFilterState({ computed: false }, row(), true)).toBe('waiting')
  })

  it('says a guest without a row is not a member of a zone', () => {
    expect(guestFilterState(computed, undefined, true)).toBe('notMember')
  })

  it('says filtered, or to come once a zone is enforced and applied', () => {
    expect(guestFilterState(computed, row({ applied: true }), true)).toBe('filtered')
    expect(guestFilterState(computed, row({ applied: false }), true)).toBe('willFilter')
  })

  it('says why a guest is not filtered before anything else', () => {
    expect(guestFilterState(computed, row({ mode: 'excluded', applied: true }), true)).toBe('excluded')
    expect(guestFilterState(computed, row({ mode: 'manual' }), true)).toBe('manual')
    expect(guestFilterState(computed, row({ mode: 'no_address', applied: false }), true)).toBe('noAddress')
  })

  it('says the filter is off for a policy that does not filter, unless Proxmox still filters the guest', () => {
    expect(guestFilterState(computed, row({ applied: false }), false)).toBe('off')
    expect(guestFilterState(computed, row({ applied: true }), false)).toBe('filtered')
  })

  it('is the state of a row in a list of members', () => {
    expect(rowState(row())).toBe('filtered')
    expect(rowState(row({ applied: false }))).toBe('willFilter')
    expect(rowState(row({ mode: 'no_address' }))).toBe('noAddress')
  })
})

describe('what needs attention', () => {
  it('is a member without an address, a hand-made list, an address held, an unknown source or a NIC on DHCP; not a member left out', () => {
    expect(needsAttention(row())).toBe(false)
    expect(needsAttention(row({ mode: 'excluded' }))).toBe(false)
    expect(needsAttention(row({ dhcp: ['net0'] }))).toBe(true)
    expect(needsAttention(row({ mode: 'excluded', dhcp: ['net0'] }))).toBe(false)
    expect(needsAttention(row({ mode: 'no_address' }))).toBe(true)
    expect(needsAttention(row({ mode: 'manual' }))).toBe(true)
    expect(needsAttention(row({ held: [{ nic: 'net0', addr: '10.0.0.7', reason: 'guest', by: 'db-1' }] }))).toBe(true)
    expect(needsAttention(row({ unknown: ['10.0.0.99'] }))).toBe(true)
    expect(needsAttention(row({ held: null, unknown: [] }))).toBe(false)
  })

  it('counts the members ready and those to look at', () => {
    const guests = [row(), row({ vmid: 2, applied: false }), row({ vmid: 3, mode: 'excluded' }), row({ vmid: 4, mode: 'no_address' }), row({ vmid: 5, unknown: ['10.0.0.99'] })]
    expect(ipFilterCounts(guests)).toEqual({ members: 5, ready: 2, attention: 2 })
    expect(ipFilterCounts([])).toEqual({ members: 0, ready: 0, attention: 0 })
  })
})

describe('why an address is held', () => {
  it('picks the sentence by reason, a general one without a name or for a reason it does not know', () => {
    expect(heldKey({ reason: 'guest', by: 'db-1' })).toBe('guest')
    expect(heldKey({ reason: 'guest' })).toBe('guestUnnamed')
    expect(heldKey({ reason: 'peer', by: 'x' })).toBe('peer')
    expect(heldKey({ reason: 'source', by: '10.0.0.0/24' })).toBe('source')
    expect(heldKey({ reason: 'source' })).toBe('other')
    expect(heldKey({ reason: 'later' })).toBe('other')
  })
})
