import { describe, expect, it } from 'vitest'

import { countPendingChanges } from './pendingChanges'
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
