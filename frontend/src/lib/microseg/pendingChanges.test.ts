import { describe, expect, it } from 'vitest'

import { countPendingChanges, diffCount, policyDiff } from './pendingChanges'
import type { MicrosegFlow, MicrosegRevision, MicrosegZone, PendingMember } from './types'

const zone = (id: string, over: Partial<MicrosegZone> = {}): MicrosegZone => ({
  id, policy_id: 'p', name: id, label: '', color: '#fff', enforcement: 'guest', vnet_id: '', state: 'disabled',
  isolate_members: false, observe_since: null, ...over,
})
const flow = (id: string, over: Partial<MicrosegFlow> = {}): MicrosegFlow => ({
  id, policy_id: 'p', src_zone_id: 'a', src_cidr: '', dst_zone_id: 'b', dst_cidr: '', proto: 'tcp', dport: '443',
  comment: '', origin: 'manual', created_by: 'me', ...over,
})
const member = (vmid: number): PendingMember => ({ id: `m${vmid}`, policy_id: 'p', node: 'pve1', type: 'qemu', vmid, zone_id: 'a' })
const revision = (zones: MicrosegZone[], flows: MicrosegFlow[], tag_prefix = 'zone-'): MicrosegRevision => ({
  id: 'r1', version: 3, author: 'me', created_at: '2026-11-02T10:00:00Z', snapshot: { tag_prefix, zones, flows },
})

describe('countPendingChanges', () => {
  const last = revision([zone('a'), zone('b')], [flow('f1'), flow('f2')])

  it('counts a zone added, a flow removed and a pending member as 3 changes', () => {
    const draft = { zones: [zone('a'), zone('b'), zone('c')], flows: [flow('f1')], pending_members: [member(100)] }
    expect(countPendingChanges(draft, last)).toBe(3)
  })

  it('counts nothing when the draft equals the last revision', () => {
    const draft = { zones: [zone('a'), zone('b')], flows: [flow('f1'), flow('f2')], pending_members: [] }
    expect(countPendingChanges(draft, last)).toBe(0)
  })

  it('counts an edited zone or flow once, by value, and compares observe_since as an instant', () => {
    const l = revision([zone('a', { observe_since: '2026-11-02T10:00:00Z' })], [flow('f1')])
    const same = { zones: [zone('a', { observe_since: '2026-11-02T10:00:00.000Z' })], flows: [flow('f1')], pending_members: [] }
    expect(countPendingChanges(same, l)).toBe(0)
    const edited = { zones: [zone('a', { observe_since: '2026-11-02T10:00:00Z', color: '#000' })], flows: [flow('f1', { dport: '8443' })], pending_members: [] }
    expect(countPendingChanges(edited, l)).toBe(2)
  })

  it('counts a moved tag prefix', () => {
    const draft = { zones: [zone('a'), zone('b')], flows: [flow('f1'), flow('f2')], pending_members: [], tag_prefix: 'seg-' }
    expect(countPendingChanges(draft, last)).toBe(1)
  })

  it('counts everything when no revision exists yet', () => {
    expect(countPendingChanges({ zones: [zone('a')], flows: [flow('f1'), flow('f2')], pending_members: [member(1)] }, null)).toBe(4)
  })

  it('counts only the pending members when the revision carries no snapshot', () => {
    const bare: MicrosegRevision = { id: 'r1', version: 3, author: 'me', created_at: '2026-11-02T10:00:00Z' }
    expect(countPendingChanges({ zones: [zone('a')], flows: [], pending_members: [member(1), member(2)] }, bare)).toBe(2)
  })
})

describe('policyDiff', () => {
  const last = revision([zone('a'), zone('b'), zone('gone')], [flow('f1'), flow('f2'), flow('f3')])

  it('tells each zone and flow added, changed (by value) or removed, by id, and keeps the removed items', () => {
    const draft = {
      zones: [zone('a'), zone('b', { state: 'enforce' }), zone('c')],
      flows: [flow('f1'), flow('f2', { dport: '22' }), flow('f4')],
      pending_members: [member(100)],
      tag_prefix: 'zone-',
    }
    const diff = policyDiff(draft, last)!
    expect([...diff.zones]).toEqual([['b', 'changed'], ['c', 'added'], ['gone', 'removed']])
    expect([...diff.flows]).toEqual([['f2', 'changed'], ['f4', 'added'], ['f3', 'removed']])
    expect(diff.removedZones.map(z => z.id)).toEqual(['gone'])
    expect(diff.removedFlows.map(f => f.id)).toEqual(['f3'])
    expect(diff.members).toBe(1)
    expect(diff.prefix).toBe(false)
    expect(diffCount(diff)).toBe(countPendingChanges(draft, last))
  })

  it('makes everything added without a revision, and gives nothing without its snapshot', () => {
    const draft = { zones: [zone('a')], flows: [flow('f1')], pending_members: [] }
    const diff = policyDiff(draft, null)!
    expect([...diff.zones.values(), ...diff.flows.values()]).toEqual(['added', 'added'])
    expect(diff.removedZones).toEqual([])
    expect(policyDiff(draft, { id: 'r1', version: 1, author: 'me', created_at: '' })).toBeNull()
  })

  it('notes a moved tag prefix', () => {
    const draft = { zones: [zone('a'), zone('b'), zone('gone')], flows: [flow('f1'), flow('f2'), flow('f3')], pending_members: [], tag_prefix: 'seg-' }
    expect(policyDiff(draft, last)!.prefix).toBe(true)
  })
})
