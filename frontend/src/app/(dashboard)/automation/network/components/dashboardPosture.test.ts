import { describe, expect, it } from 'vitest'

import type { FirewallCoverage } from '@/hooks/useZeroTrust'
import type { MicrosegFlow, MicrosegSuggestion, MicrosegZone } from '@/lib/microseg/types'

import {
  MAX_CHORDS, MAX_SLICES, arcPath, chordPath, polar, postureDistribution, postureGuests, postureTraffic, protectedRunning, topServices, zonesEnforced,
} from './dashboardPosture'
import type { PolicyGuest } from './microseg/zoneModel'

const zone = (id: string, name: string, over: Partial<MicrosegZone> = {}): MicrosegZone => ({
  id, policy_id: 'p1', name, label: '', color: `#${id.padStart(6, '0')}`, enforcement: 'guest', vnet_id: '', state: 'observe', isolate_members: false, observe_since: null, ...over,
})

let seq = 0
const seen = (over: Partial<MicrosegSuggestion>): MicrosegSuggestion => ({
  id: `s${seq++}`, policy_id: 'p1', kind: 'would_block', src_key: '', src_ip: '', src_zone_id: '', dst_ip: '', dst_zone_id: 'zdb',
  proto: 'tcp', dport: '5432', hits: 1, first_seen: '2026-11-03T08:00:00Z', last_seen: '2026-11-03T09:00:00Z', status: 'pending', ...over,
})

const flow = (over: Partial<MicrosegFlow>): MicrosegFlow => ({
  id: `f${seq++}`, policy_id: 'p1', src_zone_id: 'zweb', src_cidr: '', dst_zone_id: 'zdb', dst_cidr: '', proto: 'tcp', dport: '5432', comment: '', origin: 'manual', created_by: 'me', ...over,
})

type Row = NonNullable<FirewallCoverage['guests']>[number]
const row = (vmid: number, node: string, tags: string[], vlans: number[], status = 'running', enabled: boolean | null = true): Row => ({
  type: 'qemu', node, vmid: String(vmid), name: `vm${vmid}`, status, tags, enabled, optionsEnabled: enabled, nicFirewall: enabled, options: null, vlans,
})
const guest = (vmid: number, node: string, tags: string[], ips: string[]): PolicyGuest => ({ vmid, name: `vm${vmid}`, node, type: 'qemu', status: 'running', tags, ips })

const ZONES = [zone('zweb', 'web'), zone('zdb', 'db', { state: 'enforce' }), zone('zapp', 'app')]
/** web 101 (10.0.0.1, VLAN 10, pve1), db 102 (10.0.0.2, VLAN 20, pve2), app 103 (10.0.0.3, no VLAN, pve1), unzoned 104 (10.0.0.4). */
const ROWS = [row(101, 'pve1', ['zone-web'], [10]), row(102, 'pve2', ['zone-db'], [20]), row(103, 'pve1', ['Zone-App'], []), row(104, 'pve2', [], [30], 'stopped', false)]
const GUESTS = [guest(101, 'pve1', ['zone-web'], ['10.0.0.1/24']), guest(102, 'pve2', ['zone-db'], ['10.0.0.2']), guest(103, 'pve1', ['zone-app'], ['10.0.0.3']), guest(104, 'pve2', [], ['10.0.0.4'])]

const FLOWS_SEEN = [
  seen({ src_zone_id: 'zweb', src_ip: '10.0.0.1', dst_zone_id: 'zdb', dst_ip: '10.0.0.2', hits: 300 }),
  seen({ src_zone_id: 'zapp', src_ip: '10.0.0.3', dst_zone_id: 'zdb', dst_ip: '10.0.0.2', hits: 100, kind: 'blocked' }),
  seen({ src_ip: '10.0.0.4', dst_zone_id: 'zweb', dst_ip: '10.0.0.1', hits: 50, dport: '22' }),
  seen({ src_ip: '203.0.113.9', dst_zone_id: 'zweb', dst_ip: '10.0.0.1', hits: 50, dport: '22' }),
]

const input = (over: Partial<Parameters<typeof postureTraffic>[0]> = {}) => ({
  groupBy: 'zone' as const, zones: ZONES, tagPrefix: 'zone-', suggestions: FLOWS_SEEN, guests: postureGuests(ROWS, GUESTS), addresses: true, ...over,
})

describe('postureGuests', () => {
  it('joins the coverage rows (VLANs) with the guest list (addresses) by type and VMID', () => {
    const joined = postureGuests(ROWS, GUESTS)
    expect(joined.find(g => g.key === 'qemu/101')).toEqual({ key: 'qemu/101', node: 'pve1', tags: ['zone-web'], vlans: [10], ips: ['10.0.0.1/24'] })
    expect(postureGuests(ROWS, null).every(g => g.ips.length === 0)).toBe(true)
    expect(postureGuests(undefined, [guest(9, 'pve3', [], ['10.9.9.9'])])).toEqual([{ key: 'qemu/9', node: 'pve3', tags: [], vlans: [], ips: ['10.9.9.9'] }])
  })
})

describe('postureTraffic: grouped by destination zone', () => {
  it('names an outbound destination outside the zones Outside, kept apart from Unknown / External', () => {
    const outbound = seen({ direction: 'out', src_zone_id: 'zweb', src_ip: '10.0.0.1', dst_zone_id: '', dst_ip: '198.51.100.7', hits: 40 })
    const { slices } = postureTraffic(input({ groupBy: 'dstzone', suggestions: [...FLOWS_SEEN, outbound] }))
    expect(slices.map(s => [s.key, s.kind, s.hits])).toContainEqual(['outside', 'outside', 40])
    // The unknown sources of the inbound flows are still Unknown on the source side of the zone grouping.
    expect(postureTraffic(input({ suggestions: [...FLOWS_SEEN, outbound] })).slices.map(s => s.key)).not.toContain('outside')
  })
})

describe('postureTraffic: hits per source zone', () => {
  it('sums the hits per source zone, Unzoned and Unknown / External included, busiest first', () => {
    const { total, slices } = postureTraffic(input())
    expect(total).toBe(500)
    expect(slices.map(s => [s.key, s.hits])).toEqual([['zone:zweb', 300], ['zone:zapp', 100], ['external', 50], ['unzoned', 50]])
    expect(slices[0]).toMatchObject({ kind: 'zone', name: 'web', percent: 60, members: 1, color: '#00zweb' })
    // Tags are compared lowercased: "Zone-App" is a member of app.
    expect(slices[1].members).toBe(1)
    expect(slices.find(s => s.key === 'unzoned')?.members).toBe(1)
    expect(slices.find(s => s.key === 'external')?.members).toBeNull()
  })

  it('puts every source in no zone in Unknown / External while the guest addresses are not read', () => {
    const { slices } = postureTraffic(input({ addresses: false, guests: postureGuests(ROWS, null) }))
    // Ties by key: external before zone:zapp.
    expect(slices.map(s => [s.key, s.hits])).toEqual([['zone:zweb', 300], ['external', 100], ['zone:zapp', 100]])
  })

  it('lays the slices around the circle in proportion of their hits', () => {
    const { slices } = postureTraffic(input())
    expect(slices[0].start).toBe(0)
    expect(slices[0].end).toBeCloseTo(0.6 * 2 * Math.PI)
    expect(slices.at(-1)!.end).toBeCloseTo(2 * Math.PI)
  })

  it('sums the groups past the 8th in one Other slice', () => {
    const zones = Array.from({ length: 10 }, (_, i) => zone(`z${i}`, `zone${i}`))
    const suggestions = zones.map((z, i) => seen({ src_zone_id: z.id, dst_zone_id: 'z0', hits: 100 - i }))
    const { slices } = postureTraffic(input({ zones, suggestions }))
    expect(slices).toHaveLength(MAX_SLICES + 1)
    expect(slices.at(-1)).toMatchObject({ key: 'other', kind: 'other', hits: 91 + 92 })
  })

  it('says nothing without observed flows', () => {
    expect(postureTraffic(input({ suggestions: [] }))).toEqual({ total: 0, slices: [], chords: [] })
  })
})

describe('postureTraffic: chords', () => {
  it('joins the groups that exchange traffic, in the colour of the source; a destination that is no slice draws none', () => {
    const { chords, slices } = postureTraffic(input())
    const colour = (key: string) => slices.find(s => s.key === key)!.color
    // db sends nothing, so it is no slice: web to db and app to db draw no chord in the zone grouping.
    expect(chords).toEqual([
      { source: 'external', target: 'zone:zweb', hits: 50, color: colour('external') },
      { source: 'unzoned', target: 'zone:zweb', hits: 50, color: colour('unzoned') },
    ])
    const both = postureTraffic(input({ suggestions: [...FLOWS_SEEN, seen({ src_zone_id: 'zdb', dst_zone_id: 'zweb', hits: 1 })] }))
    expect(both.chords[0]).toEqual({ source: 'zone:zweb', target: 'zone:zdb', hits: 300, color: '#00zweb' })
  })

  it('keeps only pairs whose two ends are slices, and the 6 busiest', () => {
    const zones = Array.from({ length: 5 }, (_, i) => zone(`z${i}`, `zone${i}`))
    const suggestions = zones.flatMap((a, i) => zones.filter(b => b !== a).map((b, j) => seen({ src_zone_id: a.id, dst_zone_id: b.id, hits: 10 * (i + 1) + j })))
    const { chords } = postureTraffic(input({ zones, suggestions }))
    expect(chords).toHaveLength(MAX_CHORDS)
    expect(chords[0].hits).toBeGreaterThanOrEqual(chords[5].hits)
    expect(chords.every(c => c.source !== c.target)).toBe(true)
  })
})

describe('postureTraffic: group by VLAN or node', () => {
  it('groups the same hits by the VLAN of the destination guest (its first NIC), Unknown when no guest has the address', () => {
    const suggestions = [...FLOWS_SEEN, seen({ src_zone_id: 'zweb', dst_zone_id: 'zapp', dst_ip: '10.0.0.3', hits: 20 }), seen({ dst_ip: '10.7.7.7', hits: 5 })]
    const { slices, chords } = postureTraffic(input({ groupBy: 'vlan', suggestions }))
    expect(slices.map(s => [s.key, s.hits, s.members])).toEqual([['vlan:20', 400, 1], ['vlan:10', 100, 1], ['vlan:none', 20, 1], ['external', 5, null]])
    expect(slices[0]).toMatchObject({ kind: 'vlan', name: '20' })
    expect(slices[2].kind).toBe('novlan')
    // web (VLAN 10) to db (VLAN 20); the sources on no known guest are Unknown.
    expect(chords[0]).toMatchObject({ source: 'vlan:10', target: 'vlan:20', hits: 300 })
  })

  it('groups the same hits by the node of the destination guest', () => {
    const { slices } = postureTraffic(input({ groupBy: 'node' }))
    expect(slices.map(s => [s.key, s.hits, s.members])).toEqual([['node:pve2', 400, 2], ['node:pve1', 100, 2]])
    expect(slices[0]).toMatchObject({ kind: 'node', name: 'pve2' })
  })

  it('puts everything in Unknown without the guest addresses', () => {
    const { slices } = postureTraffic(input({ groupBy: 'node', addresses: false }))
    expect(slices.map(s => s.key)).toEqual(['external'])
  })
})

describe('donut geometry', () => {
  it('measures angles clockwise from twelve o\'clock', () => {
    expect(polar(10, 0)).toEqual({ x: 0, y: -10 })
    expect(polar(10, Math.PI / 2).x).toBeCloseTo(10)
  })

  it('draws an arc, the large flag past half a turn, and a full turn as two halves', () => {
    expect(arcPath(10, 0, Math.PI / 2)).toBe('M 0 -10 A 10 10 0 0 1 10 0')
    expect(arcPath(10, 0, 1.5 * Math.PI)).toBe('M 0 -10 A 10 10 0 1 1 -10 0')
    expect(arcPath(10, 0, 2 * Math.PI)).toBe('M 0 -10 A 10 10 0 0 1 0 10 A 10 10 0 0 1 0 -10')
  })

  it('curves a chord through the centre between the middles of two slices', () => {
    expect(chordPath(10, { start: 0, end: Math.PI }, { start: Math.PI, end: 2 * Math.PI })).toBe('M 10 0 Q 0 0 -10 0')
  })
})

describe('postureDistribution', () => {
  it('splits the hits: East-West from a zone or a guest, unknown source; counts the flows', () => {
    const d = postureDistribution({ zones: ZONES, tagPrefix: 'zone-', flows: [flow({}), flow({ dport: '443' })], suggestions: FLOWS_SEEN, guests: postureGuests(ROWS, GUESTS), addresses: true })
    expect(d.total).toBe(500)
    expect(d.eastWest).toEqual({ hits: 450, percent: 90 })
    expect(d.unknown).toEqual({ hits: 50, percent: 10 })
    expect(d).toMatchObject({ allowed: 2, wouldBlock: 3, blocked: 1, blockedZones: ['db'] })
  })

  it('counts every source in no zone as unknown without the guest addresses, and leaves out a flow to a zone gone since', () => {
    const suggestions = [...FLOWS_SEEN, seen({ dst_zone_id: 'gone', hits: 100 })]
    const d = postureDistribution({ zones: ZONES, tagPrefix: 'zone-', flows: [], suggestions, guests: [], addresses: false })
    expect(d.total).toBe(500)
    expect(d.unknown).toEqual({ hits: 100, percent: 20 })
    expect(d.eastWest).toEqual({ hits: 400, percent: 80 })
  })

  it('gives 0 % of nothing', () => {
    const d = postureDistribution({ zones: ZONES, tagPrefix: 'zone-', flows: [], suggestions: [], guests: [], addresses: false })
    expect(d.eastWest).toEqual({ hits: 0, percent: 0 })
    expect(d.blockedZones).toEqual([])
  })
})

describe('topServices', () => {
  it('sums the observed flows per service and status, busiest first, then the services the policy allows', () => {
    const rows = topServices(FLOWS_SEEN, [flow({}), flow({ dport: '9100' }), flow({ dport: '9100', src_zone_id: 'zapp' }), flow({ proto: 'ICMP', dport: '' })])
    expect(rows).toEqual([
      { key: 'not_covered|PostgreSQL', label: 'PostgreSQL', tokens: ['tcp/5432'], flows: 1, hits: 300, status: 'not_covered' },
      { key: 'blocked|PostgreSQL', label: 'PostgreSQL', tokens: ['tcp/5432'], flows: 1, hits: 100, status: 'blocked' },
      { key: 'not_covered|SSH', label: 'SSH', tokens: ['tcp/22'], flows: 2, hits: 100, status: 'not_covered' },
      { key: 'allowed|node-exporter', label: 'node-exporter', tokens: ['tcp/9100'], flows: 2, hits: null, status: 'allowed' },
      { key: 'allowed|PostgreSQL', label: 'PostgreSQL', tokens: ['tcp/5432'], flows: 1, hits: null, status: 'allowed' },
      { key: 'allowed|icmp', label: 'icmp', tokens: ['icmp'], flows: 1, hits: null, status: 'allowed' },
    ])
  })

  it('merges the ports of one service name and status, summing flows and hits, the raw tokens kept', () => {
    const rows = topServices([
      seen({ dport: '8080', hits: 5 }), seen({ dport: '8081', hits: 7 }), seen({ proto: 'TCP', dport: '8080', hits: 1 }),
      seen({ dport: '22', hits: 2 }), seen({ proto: 'udp', dport: '22', hits: 3 }), seen({ dport: '22', hits: 4, src_ip: '10.9.9.9' }),
    ], [])
    expect(rows).toEqual([
      { key: 'not_covered|HTTP-alt', label: 'HTTP-alt', tokens: ['tcp/8080', 'tcp/8081'], flows: 3, hits: 13, status: 'not_covered' },
      { key: 'not_covered|SSH', label: 'SSH', tokens: ['tcp/22', 'udp/22'], flows: 3, hits: 9, status: 'not_covered' },
    ])
  })

  it('keeps the top 8', () => {
    const many = Array.from({ length: 12 }, (_, i) => seen({ dport: String(40000 + i), hits: i }))
    const rows = topServices(many, [])
    expect(rows).toHaveLength(8)
    expect(rows[0]).toMatchObject({ label: 'tcp/40011', hits: 11 })
  })
})

describe('header figures', () => {
  it('counts the zones that enforce of all the zones', () => {
    expect(zonesEnforced({ zones_by_state: { enforce: 1, observe: 4, disabled: 1 } })).toEqual({ enforced: 1, total: 6 })
    expect(zonesEnforced(undefined)).toBeNull()
  })

  it('counts the running guests Proxmox filters, of the running guests, once measured', () => {
    expect(protectedRunning({ computedAt: '2026-11-03T08:00:00Z', guests: ROWS })).toEqual({ protected: 3, running: 3 })
    expect(protectedRunning({ computedAt: '2026-11-03T08:00:00Z', guests: [row(1, 'pve1', [], [], 'running', null), row(2, 'pve1', [], [])] })).toEqual({ protected: 1, running: 2 })
    expect(protectedRunning({ computedAt: '', guests: ROWS })).toBeNull()
    expect(protectedRunning(null)).toBeNull()
  })
})
