/**
 * Fixtures of the pure models of the map renderings (compact zones, matrix, guest view): the factories and a
 * demo-like draft (6 zones of 8/8/6/4/4/2 members, guests in no zone, 12 flows, observed pairs of each kind).
 */

import type { MicrosegFlow, MicrosegSuggestion, MicrosegZone } from '@/lib/microseg/types'

import type { MapInput, MapMember } from './zoneGraph'

export const zone = (id: string, name: string, over: Partial<MicrosegZone> = {}): MicrosegZone => ({
  id, policy_id: 'p1', name, label: '', color: '#3b82f6', enforcement: 'guest', vnet_id: '', state: 'observe',
  isolate_members: false, observe_since: null, ...over,
})

export const flow = (id: string, over: Partial<MicrosegFlow> = {}): MicrosegFlow => ({
  id, policy_id: 'p1', src_zone_id: 'zw', src_cidr: '', dst_zone_id: 'zd', dst_cidr: '', proto: 'tcp', dport: '443',
  comment: '', origin: 'manual', created_by: 'me', ...over,
})

export const seen = (id: string, over: Partial<MicrosegSuggestion> = {}): MicrosegSuggestion => ({
  id, policy_id: 'p1', kind: 'would_block', src_key: 'k', src_ip: '', src_zone_id: 'zw', dst_ip: '', dst_zone_id: 'zd',
  proto: 'tcp', dport: '80', hits: 3, first_seen: '2026-11-02T10:00:00Z', last_seen: '2026-11-02T11:00:00Z', status: 'pending', ...over,
})

export const member = (vmid: number, name: string, ips: string[] = [], over: Partial<MapMember> = {}): MapMember => ({
  key: `qemu/${vmid}`, name, vmid, node: 'pve1', type: 'qemu', status: 'running', ips, pending: false, ...over,
})

/** id, name, member count: web 10.0.1.x, admin 10.0.2.x, app 10.0.3.x, db 10.0.4.x, cache 10.0.5.x, monitoring 10.0.6.x. */
export const DEMO_ZONES: Array<[string, string, number]> = [
  ['zw', 'web', 8], ['zad', 'admin', 8], ['za', 'app', 6], ['zd', 'db', 4], ['zc', 'cache', 4], ['zm', 'monitoring', 2],
]

export function demoInput(): Required<Pick<MapInput, 'zones' | 'flows' | 'suggestions'>> & { members: Map<string, MapMember[]>; unzoned: MapMember[] } {
  const zones = DEMO_ZONES.map(([id, name]) => zone(id, name))
  const members = new Map(DEMO_ZONES.map(([id, name, n], z) => [id, Array.from({ length: n }, (_, i) => member(100 * (z + 1) + i, `${name}-${i + 1}`, [`10.0.${z + 1}.${i + 1}`]))]))
  const flows = [
    flow('f01', { src_zone_id: '', src_cidr: '0.0.0.0/0', dst_zone_id: 'zw', dport: '443' }),
    flow('f02', { src_zone_id: '', src_cidr: '192.0.2.0/24', dst_zone_id: 'zad', dport: '22' }),
    flow('f03', { src_zone_id: 'zw', dst_zone_id: 'za', dport: '8080' }),
    flow('f04', { src_zone_id: 'zad', dst_zone_id: 'za', dport: '8080' }),
    flow('f05', { src_zone_id: 'zad', dst_zone_id: 'za', dport: '22' }),
    flow('f06', { src_zone_id: 'za', dst_zone_id: 'zw', dport: '9000' }),
    flow('f07', { src_zone_id: 'za', dst_zone_id: 'zd', dport: '5432' }),
    flow('f08', { src_zone_id: 'za', dst_zone_id: 'zc', dport: '6379' }),
    flow('f09', { src_zone_id: 'zm', dst_zone_id: 'za', dport: '9100' }),
    flow('f10', { src_zone_id: 'zm', dst_zone_id: 'zd', dport: '9187' }),
    flow('f11', { src_zone_id: 'zm', dst_zone_id: 'zc', dport: '9121' }),
    flow('f12', { src_zone_id: 'zd', dst_zone_id: '', dst_cidr: '10.99.0.0/16', proto: 'udp', dport: '53' }),
  ]
  const suggestions = [
    seen('s1', { src_zone_id: 'zw', src_ip: '10.0.1.1', dst_zone_id: 'zd', dst_ip: '10.0.4.1', dport: '5432', hits: 40 }),
    seen('s2', { src_zone_id: 'zad', src_ip: '10.0.2.2', dst_zone_id: 'zc', dst_ip: '10.0.5.1', dport: '6379', hits: 12 }),
    seen('s3', { kind: 'blocked', src_zone_id: '', src_ip: '203.0.113.9', dst_zone_id: 'zw', dst_ip: '10.0.1.3', dport: '3389', hits: 7 }),
    seen('s4', { src_zone_id: '', src_ip: '10.9.0.1', dst_zone_id: 'za', dst_ip: '10.0.3.2', dport: '8080', hits: 30 }),
    seen('s5', { kind: 'blocked', src_zone_id: 'zw', src_ip: '10.0.1.2', dst_zone_id: 'zd', dst_ip: '10.0.4.2', dport: '22', hits: 150 }),
    seen('s6', { kind: 'blocked', src_zone_id: 'zc', src_ip: '10.0.5.2', dst_zone_id: 'zd', dst_ip: '10.0.4.3', dport: '5432', hits: 96 }),
    // Two zones of the same column (as on the lab: monitoring -> admin tcp/22), and the reply the other way.
    seen('s7', { src_zone_id: 'zm', src_ip: '10.0.6.1', dst_zone_id: 'zad', dst_ip: '10.0.2.1', dport: '22', hits: 20 }),
    seen('s8', { src_zone_id: 'zad', src_ip: '10.0.2.1', dst_zone_id: 'zm', dst_ip: '10.0.6.1', dport: '9100', hits: 5 }),
  ]
  const unzoned = [member(900, 'lost-1', ['10.9.0.1']), member(901, 'lost-2'), member(902, 'lost-3')]
  return { zones, flows, suggestions, members, unzoned }
}
