import { describe, expect, it } from 'vitest'

import { guestCandidates, isVdcPool, memberRequests, storageCandidates, type GuestCandidate } from './poolMembers'

const g = (vmid: number, extra: Partial<GuestCandidate> = {}): GuestCandidate => ({ vmid, type: 'qemu', node: 'n1', name: `vm${vmid}`, status: 'running', ...extra })

describe('pool membership helpers', () => {
  it('recognises a vDC pool by its prefix', () => {
    expect(isVdcPool('vdc-acme-prod')).toBe(true)
    expect(isVdcPool('docs')).toBe(false)
    expect(isVdcPool(null)).toBe(false)
  })

  it('offers the guests that may join: no member, no template, none held by a vDC', () => {
    const all = [g(300), g(101), g(102, { template: true }), g(103, { pool: 'vdc-x' }), g(104, { pool: 'p1' }), g(105, { pool: 'other' })]

    expect(guestCandidates(all, [g(300)], 'p1').map(c => c.vmid)).toEqual([101, 105])
  })

  it('offers each storage once, minus the members, sorted', () => {
    expect(storageCandidates(['local', 'ceph', 'local', 'nfs'], [{ storage: 'nfs', type: 'nfs', shared: true, nodes: [] }])).toEqual(['ceph', 'local'])
  })

  it('turns the edits into one add call (moving pooled guests) and one remove call', () => {
    expect(memberRequests('p1', { addGuests: [g(101), g(102, { pool: 'other' })], removeGuests: [7], addStorages: ['ceph'], removeStorages: ['nfs'] })).toEqual([
      { poolid: 'p1', vms: [101, 102], storage: ['ceph'], allowMove: true },
      { poolid: 'p1', vms: [7], storage: ['nfs'], delete: true },
    ])
  })

  it('sends nothing without an edit, and only what was edited otherwise', () => {
    expect(memberRequests('p1', { addGuests: [], removeGuests: [], addStorages: [], removeStorages: [] })).toEqual([])
    expect(memberRequests('p1', { addGuests: [], removeGuests: [], addStorages: ['ceph'], removeStorages: [] })).toEqual([{ poolid: 'p1', storage: ['ceph'] }])
    expect(memberRequests('p1', { addGuests: [g(5)], removeGuests: [], addStorages: [], removeStorages: [] })).toEqual([{ poolid: 'p1', vms: [5] }])
    expect(memberRequests('p1', { addGuests: [], removeGuests: [], addStorages: [], removeStorages: ['nfs'] })).toEqual([{ poolid: 'p1', storage: ['nfs'], delete: true }])
  })
})
