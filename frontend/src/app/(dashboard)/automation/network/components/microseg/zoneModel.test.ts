import { describe, expect, it } from 'vitest'

import type { MicrosegFlow, MicrosegSuggestion, PendingMember } from '@/lib/microseg/types'

import { flowsOfZone, isZoneReady, zoneMembers, type PolicyGuest } from './zoneModel'
import { flow, zone } from './microsegTestKit'

const guest = (vmid: number, tags: string[], over: Partial<PolicyGuest> = {}): PolicyGuest => ({
  vmid, name: `vm${vmid}`, node: 'pve1', type: 'qemu', status: 'running', tags, ...over,
})

describe('zoneMembers', () => {
  const z = zone('z1', { name: 'web' })

  it('keeps the guests tagged with the prefix and the zone name', () => {
    const members = zoneMembers(z, 'zone-', [guest(100, ['zone-web']), guest(101, ['zone-db']), guest(102, ['web']), guest(103, ['x', 'zone-web'])], [])
    expect(members.map(m => m.ref.vmid)).toEqual([100, 103])
    expect(members.every(m => !m.pending)).toBe(true)
  })

  it('adds the pending members of the zone that carry no tag yet, once', () => {
    const pending: PendingMember[] = [
      { id: 'p1', policy_id: 'p', node: 'pve1', type: 'qemu', vmid: 100, zone_id: 'z1' },
      { id: 'p2', policy_id: 'p', node: 'pve2', type: 'lxc', vmid: 200, zone_id: 'z1' },
      { id: 'p3', policy_id: 'p', node: 'pve2', type: 'lxc', vmid: 300, zone_id: 'other' },
      { id: 'p4', policy_id: 'p', node: 'pve2', type: 'lxc', vmid: 400, zone_id: '' },
    ]
    const members = zoneMembers(z, 'zone-', [guest(100, ['zone-web']), guest(200, [], { node: 'pve2', type: 'lxc' })], pending)
    expect(members.map(m => [m.ref.vmid, m.pending])).toEqual([[100, false], [200, true]])
    expect(members[1].guest?.name).toBe('vm200')
  })

  it('keeps a pending member whose guest is not in the inventory', () => {
    const pending: PendingMember[] = [{ id: 'p1', policy_id: 'p', node: 'pve9', type: 'qemu', vmid: 900, zone_id: 'z1' }]
    const members = zoneMembers(z, 'zone-', [], pending)
    expect(members).toHaveLength(1)
    expect(members[0].guest).toBeNull()
    expect(members[0].ref).toEqual({ node: 'pve9', type: 'qemu', vmid: 900 })
  })
})

describe('flowsOfZone', () => {
  const f = (id: string, over: Partial<MicrosegFlow>): MicrosegFlow => ({ ...flow(id), ...over })
  it('splits incoming and outgoing flows', () => {
    const flows = [f('1', { src_zone_id: 'a', dst_zone_id: 'b' }), f('2', { src_zone_id: 'b', dst_zone_id: 'a' }), f('3', { src_zone_id: '', src_cidr: '10.0.0.0/8', dst_zone_id: 'a' }), f('4', { src_zone_id: 'c', dst_zone_id: 'd' })]
    const { incoming, outgoing } = flowsOfZone('a', flows)
    expect(incoming.map(x => x.id)).toEqual(['2', '3'])
    expect(outgoing.map(x => x.id)).toEqual(['1'])
  })
})

describe('isZoneReady', () => {
  const NOW = Date.parse('2026-11-02T12:00:00Z')
  const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString()
  const sug = (lastSeen: string): MicrosegSuggestion => ({
    id: 's', policy_id: 'p', kind: 'would_block', src_key: 'k', src_ip: '', src_zone_id: 'z1', dst_ip: '', dst_zone_id: '',
    proto: 'tcp', dport: '80', hits: 1, first_seen: lastSeen, last_seen: lastSeen, status: 'pending',
  })
  const observed = zone('z1', { state: 'observe', observe_since: hoursAgo(30) })

  it('is ready when observed for the whole window with nothing seen in it', () => {
    expect(isZoneReady(observed, [sug(hoursAgo(25))], 24, NOW)).toBe(true)
    expect(isZoneReady(observed, [], 24, NOW)).toBe(true)
  })

  it('is not ready when a pending suggestion was seen inside the window', () => {
    expect(isZoneReady(observed, [sug(hoursAgo(25)), sug(hoursAgo(2))], 24, NOW)).toBe(false)
  })

  it('is not ready when the zone was observed for less than the window, or never', () => {
    expect(isZoneReady(zone('z1', { state: 'observe', observe_since: hoursAgo(3) }), [], 24, NOW)).toBe(false)
    expect(isZoneReady(zone('z1', { state: 'disabled', observe_since: null }), [], 24, NOW)).toBe(false)
  })

  it('uses 24 hours when the setting is missing', () => {
    expect(isZoneReady(observed, [sug(hoursAgo(20))], 0, NOW)).toBe(false)
    expect(isZoneReady(zone('z1', { state: 'observe', observe_since: hoursAgo(23) }), [], undefined, NOW)).toBe(false)
  })
})
