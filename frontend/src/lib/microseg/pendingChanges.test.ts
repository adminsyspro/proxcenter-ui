import { describe, expect, it } from 'vitest'

import { countPendingChanges, diffCount, policyDiff } from './pendingChanges'
import type { MicrosegException, MicrosegFlow, MicrosegRevision, MicrosegZone, PendingMember } from './types'

const zone = (id: string, over: Partial<MicrosegZone> = {}): MicrosegZone => ({
  id, policy_id: 'p', name: id, label: '', color: '#fff', enforcement: 'guest', vnet_id: '', state: 'disabled',
  isolate_members: false, observe_since: null, ...over,
})
const flow = (id: string, over: Partial<MicrosegFlow> = {}): MicrosegFlow => ({
  id, policy_id: 'p', src_zone_id: 'a', src_cidr: '', dst_zone_id: 'b', dst_cidr: '', proto: 'tcp', dport: '443',
  comment: '', origin: 'manual', created_by: 'me', ...over,
})
const exception = (id: string, over: Partial<MicrosegException> = {}): MicrosegException => ({
  id, policy_id: 'p', zone_id: 'a', sources: [{ type: 'qemu', vmid: 101, name: 'app-01' }], destinations: [{ type: 'qemu', vmid: 201, name: 'db-01' }],
  services: [{ proto: 'tcp', dport: '5432' }], comment: '', created_by: 'me', ...over,
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

  it('counts an outbound mode or state change as a zone change, but not an absent value against off/local nor the observation instant', () => {
    const base = revision([zone('a'), zone('b')], [])
    const count = (z: Partial<MicrosegZone>) => countPendingChanges({ zones: [zone('a', z), zone('b')], flows: [], pending_members: [] }, base)
    expect(count({ egress_mode: 'all' })).toBe(1)
    expect(count({ egress_state: 'observe' })).toBe(1)
    expect(count({ egress_state: 'off', egress_mode: 'local' })).toBe(0)
    expect(count({ egress_observe_since: '2026-11-02T10:00:00Z' })).toBe(0)
    const observing = revision([zone('a', { egress_state: 'observe', egress_observe_since: '2026-11-01T10:00:00Z' }), zone('b')], [])
    expect(countPendingChanges({ zones: [zone('a', { egress_state: 'observe', egress_observe_since: '2026-11-02T10:00:00Z' }), zone('b')], flows: [], pending_members: [] }, observing)).toBe(0)
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

  it('counts a renamed zone as changed and keeps the name it had in the revision', () => {
    const draft = { zones: [zone('a', { name: 'front' }), zone('b'), zone('gone')], flows: [flow('f1'), flow('f2'), flow('f3')], pending_members: [] }
    const diff = policyDiff(draft, last)!
    expect([...diff.zones]).toEqual([['a', 'changed']])
    expect([...diff.renamedZones]).toEqual([['a', 'a']])
  })

  it('notes a moved tag prefix', () => {
    const draft = { zones: [zone('a'), zone('b'), zone('gone')], flows: [flow('f1'), flow('f2'), flow('f3')], pending_members: [], tag_prefix: 'seg-' }
    expect(policyDiff(draft, last)!.prefix).toBe(true)
  })
})

describe('exceptions', () => {
  const zones = [zone('a'), zone('b')]
  const withExceptions = (exceptions?: MicrosegException[]): MicrosegRevision => ({
    id: 'r1', version: 3, author: 'me', created_at: '2026-11-02T10:00:00Z', snapshot: { tag_prefix: 'zone-', zones, flows: [], ...(exceptions ? { exceptions } : {}) },
  })
  const draft = (exceptions: MicrosegException[]) => ({ zones, flows: [], exceptions, pending_members: [] })

  it('tells each exception added, changed (by value) or removed, by id, and counts one change each', () => {
    const last = withExceptions([exception('e1'), exception('e2'), exception('e3')])
    const now = draft([exception('e1'), exception('e2', { services: [{ proto: 'tcp', dport: '22' }] }), exception('e4')])
    const diff = policyDiff(now, last)!
    expect([...diff.exceptions]).toEqual([['e2', 'changed'], ['e4', 'added'], ['e3', 'removed']])
    expect(diffCount(diff)).toBe(3)
    expect(countPendingChanges(now, last)).toBe(3)
  })

  it('counts nothing for the exceptions the revision holds as they are', () => {
    expect(countPendingChanges(draft([exception('e1')]), withExceptions([exception('e1')]))).toBe(0)
  })

  it('counts a guest added, a guest order, a recorded name, a zone or a comment that moved as a change', () => {
    const last = withExceptions([exception('e1', { sources: [{ type: 'qemu', vmid: 101, name: 'app-01' }, { type: 'qemu', vmid: 102, name: 'app-02' }] })])
    const count = (over: Partial<MicrosegException>) => countPendingChanges(draft([exception('e1', { sources: [{ type: 'qemu', vmid: 101, name: 'app-01' }, { type: 'qemu', vmid: 102, name: 'app-02' }], ...over })]), last)
    expect(count({})).toBe(0)
    expect(count({ sources: [{ type: 'qemu', vmid: 101, name: 'app-01' }] })).toBe(1)
    expect(count({ sources: [{ type: 'qemu', vmid: 102, name: 'app-02' }, { type: 'qemu', vmid: 101, name: 'app-01' }] })).toBe(1)
    expect(count({ sources: [{ type: 'qemu', vmid: 101, name: 'renamed' }, { type: 'qemu', vmid: 102, name: 'app-02' }] })).toBe(1)
    expect(count({ destinations: [{ type: 'lxc', vmid: 201, name: 'db-01' }] })).toBe(1)
    expect(count({ zone_id: 'b' })).toBe(1)
    expect(count({ comment: 'backup' })).toBe(1)
    // Who wrote it is not a change of the policy.
    expect(count({ created_by: 'someone else' })).toBe(0)
  })

  it('reads a revision taken before the exceptions existed as holding none: every exception of the draft is added, without an error', () => {
    const old = withExceptions()
    expect(old.snapshot && 'exceptions' in old.snapshot).toBe(false)
    const diff = policyDiff(draft([exception('e1'), exception('e2')]), old)!
    expect([...diff.exceptions]).toEqual([['e1', 'added'], ['e2', 'added']])
    expect(countPendingChanges(draft([]), old)).toBe(0)
  })

  it('reads a draft given without its exceptions as holding none', () => {
    const diff = policyDiff({ zones, flows: [], pending_members: [] }, withExceptions([exception('e1')]))!
    expect([...diff.exceptions]).toEqual([['e1', 'removed']])
  })

  it('counts every exception without a revision, and none when the revision came without its snapshot', () => {
    expect(countPendingChanges(draft([exception('e1'), exception('e2')]), null)).toBe(4)
    const bare: MicrosegRevision = { id: 'r1', version: 3, author: 'me', created_at: '2026-11-02T10:00:00Z' }
    expect(countPendingChanges(draft([exception('e1')]), bare)).toBe(0)
  })
})
