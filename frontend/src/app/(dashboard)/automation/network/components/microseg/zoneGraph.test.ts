/**
 * buildZoneGraph is pure: zones, flows, observed flows and members in, React Flow nodes and edges out, with
 * positions that only depend on the input.
 */

import { describe, expect, it } from 'vitest'

import { MarkerType, type Edge, type Node } from '@xyflow/react'
import type { MicrosegFlow, MicrosegSuggestion, MicrosegZone } from '@/lib/microseg/types'

import { crossesBox, crossesCircle, rectAround, rectHitsCircle, rectsOverlap, type Rect } from './edgeGeometry'
import {
  ALL_FLOWS, EDGE_COLORS, NODE_H, NODE_W, bareIp, buildZoneGraph, filterEdges, focusSets, groupServices,
  type GuestNodeData, type MapEdgeData, type MapMember, type MoreNodeData, type ZoneNodeData,
} from './zoneGraph'
import { GLYPH_Y, GUEST_H, GUEST_R, GUEST_W, MIN_R } from './zoneLayout'

const zone = (id: string, name: string, over: Partial<MicrosegZone> = {}): MicrosegZone => ({
  id, policy_id: 'p1', name, label: '', color: '#3b82f6', enforcement: 'guest', vnet_id: '', state: 'observe',
  isolate_members: false, observe_since: null, ...over,
})

const flow = (id: string, over: Partial<MicrosegFlow> = {}): MicrosegFlow => ({
  id, policy_id: 'p1', src_zone_id: 'zw', src_cidr: '', dst_zone_id: 'zd', dst_cidr: '', proto: 'tcp', dport: '443',
  comment: '', origin: 'manual', created_by: 'me', ...over,
})

const seen = (id: string, over: Partial<MicrosegSuggestion> = {}): MicrosegSuggestion => ({
  id, policy_id: 'p1', kind: 'would_block', src_key: 'k', src_ip: '', src_zone_id: 'zw', dst_ip: '', dst_zone_id: 'zd',
  proto: 'tcp', dport: '80', hits: 3, first_seen: '2026-11-02T10:00:00Z', last_seen: '2026-11-02T11:00:00Z', status: 'pending', ...over,
})

const member = (vmid: number, name: string, ips: string[] = [], over: Partial<MapMember> = {}): MapMember => ({
  key: `qemu/${vmid}`, name, vmid, node: 'pve1', type: 'qemu', status: 'running', ips, pending: false, ...over,
})

const web = zone('zw', 'web')
const db = zone('zd', 'db')
const app = zone('za', 'app')

const data = (e: Edge) => e.data as unknown as MapEdgeData
const byId = (nodes: Node[], id: string) => nodes.find(n => n.id === id)!

describe('zone circles and their guests', () => {
  it('draws a circle per zone with its member count, and no guest while the guests are unknown', () => {
    const { nodes } = buildZoneGraph({ zones: [web, db], flows: [], suggestions: [] })
    expect(nodes.map(n => n.type)).toEqual(['zone', 'zone'])
    const w = byId(nodes, 'zone:zw')
    expect((w.data as unknown as ZoneNodeData).members).toBeNull()
    expect(w.width).toBe(2 * MIN_R)
    expect(w.height).toBe(w.width)
  })

  it('puts the guests inside their circle, as its children, and grows the circle with them', () => {
    const many = Array.from({ length: 8 }, (_, i) => member(100 + i, `web-${i}`))
    const { nodes } = buildZoneGraph({ zones: [web, db], flows: [], suggestions: [], members: new Map([['zw', many], ['zd', [member(200, 'db-0')]]]) })
    const w = byId(nodes, 'zone:zw')
    const d = byId(nodes, 'zone:zd')
    expect(w.width!).toBeGreaterThan(d.width!)
    const guests = nodes.filter(n => n.parentId === 'zone:zw')
    expect(guests).toHaveLength(8)
    expect(nodes.indexOf(w)).toBeLessThan(Math.min(...guests.map(g => nodes.indexOf(g))))
    const r = w.width! / 2
    for (const g of guests) {
      expect(g.type).toBe('guest')
      expect(Math.hypot(g.position.x + GUEST_W / 2 - r, g.position.y + GUEST_H / 2 - r)).toBeLessThan(r)
    }
    expect((guests[0].data as unknown as GuestNodeData).member.name).toBe('web-0')
    expect((w.data as unknown as ZoneNodeData).members).toBe(8)
  })

  it('collapses past 12 members into the first 11 and a "+N" node', () => {
    const many = Array.from({ length: 30 }, (_, i) => member(100 + i, `g-${String(i).padStart(2, '0')}`))
    const { nodes } = buildZoneGraph({ zones: [web], flows: [], suggestions: [], members: new Map([['zw', many]]) })
    const children = nodes.filter(n => n.parentId === 'zone:zw')
    expect(children.filter(n => n.type === 'guest')).toHaveLength(11)
    const more = children.find(n => n.type === 'more')!
    expect((more.data as unknown as MoreNodeData).count).toBe(19)
    expect(more.id).toBe('more:zw')
    expect((byId(nodes, 'zone:zw').data as unknown as ZoneNodeData).members).toBe(30)
  })

  it('draws the running guests in no zone in their own circle, only when there are some', () => {
    const none = buildZoneGraph({ zones: [web], flows: [], suggestions: [], members: new Map(), unzoned: [] })
    expect(none.nodes.find(n => n.id === 'unzoned')).toBeUndefined()
    const { nodes } = buildZoneGraph({ zones: [web], flows: [], suggestions: [], members: new Map(), unzoned: [member(900, 'lost')] })
    expect(byId(nodes, 'unzoned').type).toBe('unzoned')
    expect(nodes.filter(n => n.parentId === 'unzoned')).toHaveLength(1)
  })

  it('draws a graph with no zone and no edge', () => {
    expect(buildZoneGraph({ zones: [], flows: [], suggestions: [] })).toEqual({ nodes: [], edges: [] })
  })
})

describe('allowed flows', () => {
  it('draws one green edge per ordered pair of zones, its label grouping the ports', () => {
    const { edges } = buildZoneGraph({
      zones: [web, db, app],
      flows: [flow('f1'), flow('f2', { dport: '8080' }), flow('f3', { dport: '22' }), flow('f4', { src_zone_id: 'zd', dst_zone_id: 'za', proto: 'udp', dport: '53' }), flow('f5', { src_zone_id: 'zd', dst_zone_id: 'za', dport: '5432' })],
      suggestions: [],
    })
    expect(edges).toHaveLength(2)
    const wd = edges.find(e => e.id === 'allowed:zone:zw>zone:zd')!
    expect(data(wd)).toMatchObject({ kind: 'allowed', label: 'tcp/22, 443, 8080', count: 3, particle: true, color: EDGE_COLORS.allowed })
    expect(wd.style?.strokeDasharray).toBeUndefined()
    expect(data(edges.find(e => e.id === 'allowed:zone:zd>zone:za')!).label).toBe('tcp 5432 · udp 53')
    expect((wd.markerEnd as { type: string }).type).toBe(MarkerType.ArrowClosed)
  })

  it('keeps the two directions of a pair apart, their labels too', () => {
    const { edges } = buildZoneGraph({ zones: [web, db], flows: [flow('f1'), flow('f2', { src_zone_id: 'zd', dst_zone_id: 'zw' })], suggestions: [] })
    expect(edges).toHaveLength(2)
    const [a, b] = edges.map(data)
    // The two edges run side by side: the middle of one is well away from the middle of the other.
    const mid = (d: MapEdgeData) => d.points[Math.floor(d.points.length / 2)]
    expect(Math.hypot(mid(a).x - mid(b).x, mid(a).y - mid(b).y)).toBeGreaterThanOrEqual(20)
    expect(rectsOverlap(rectAround({ x: a.label_x, y: a.label_y }, a.label_w, a.label_h), rectAround({ x: b.label_x, y: b.label_y }, b.label_w, b.label_h))).toBe(false)
  })

  it('draws a CIDR source from the Unknown / External box and a CIDR destination as a dashed grey edge to Outside', () => {
    const { nodes, edges } = buildZoneGraph({
      zones: [web, db],
      flows: [flow('f1', { src_zone_id: '', src_cidr: '203.0.113.0/24' }), flow('f2', { dst_zone_id: '', dst_cidr: '8.8.8.0/24', proto: 'udp', dport: '53' })],
      suggestions: [],
    })
    expect(byId(nodes, 'external').type).toBe('boundary')
    expect(byId(nodes, 'outside').type).toBe('boundary')
    const out = edges.find(e => e.id === 'outside:zone:zw>outside')!
    expect(data(out)).toMatchObject({ kind: 'outside', particle: false, color: EDGE_COLORS.outside })
    expect(out.style?.strokeDasharray).toBeTruthy()
    expect(edges.find(e => e.id === 'allowed:external>zone:zd')).toBeTruthy()
  })

  it('draws the flows of the draft that are not applied yet dotted, without particle', () => {
    const { edges } = buildZoneGraph({ zones: [web, db, app], flows: [flow('f1'), flow('f2', { dst_zone_id: 'za' })], suggestions: [], unapplied: new Set(['f2']) })
    const applied = edges.find(e => e.id === 'allowed:zone:zw>zone:zd')!
    const draft = edges.find(e => e.id === 'allowed:zone:zw>zone:za')!
    expect(data(applied).draft).toBe(false)
    expect(data(draft)).toMatchObject({ draft: true, particle: false })
    expect(draft.style?.strokeDasharray).toBe('1 5')
  })

  it('ignores a flow whose zone is gone, and a flow inside one zone', () => {
    const { edges } = buildZoneGraph({ zones: [web], flows: [flow('f1'), flow('f2', { dst_zone_id: 'zw' })], suggestions: [] })
    expect(edges).toHaveLength(0)
  })
})

describe('observed flows, guest to guest', () => {
  const members = new Map([
    ['zw', [member(100, 'web-1', ['10.0.1.1/24']), member(101, 'web-2', ['10.0.1.2'])]],
    ['zd', [member(200, 'db-1', ['10.0.2.1'])]],
  ])

  it('resolves the addresses of an observed flow to the guests it went between', () => {
    const { edges } = buildZoneGraph({ zones: [web, db], flows: [], suggestions: [seen('s1', { src_ip: '10.0.1.2', dst_ip: '10.0.2.1', dport: '5432' }), seen('s2', { src_ip: '10.0.1.2', dst_ip: '10.0.2.1', dport: '22' })], members })
    expect(edges.map(e => e.id)).toEqual(['unprotected:guest:zw:qemu/101>guest:zd:qemu/200'])
    expect(data(edges[0])).toMatchObject({ kind: 'unprotected', label: 'tcp/22, 5432', count: 2, small: true, fromGroup: 'zone:zw', toGroup: 'zone:zd', color: EDGE_COLORS.unprotected })
    expect(edges[0].style?.strokeDasharray).toBeTruthy()
    expect(data(edges[0]).observed.map(s => s.id)).toEqual(['s1', 's2'])
  })

  it('draws a blocked flow as a solid blue edge, above the allowed ones', () => {
    const { edges } = buildZoneGraph({ zones: [web, db], flows: [flow('f1')], suggestions: [seen('s1', { kind: 'blocked', src_ip: '10.0.1.1', dst_ip: '10.0.2.1' })], members })
    const blocked = edges.find(e => data(e).kind === 'blocked')!
    expect(blocked.id).toBe('blocked:guest:zw:qemu/100>guest:zd:qemu/200')
    expect(blocked.style?.stroke).toBe(EDGE_COLORS.blocked)
    expect(blocked.style?.strokeDasharray).toBeUndefined()
    expect(blocked.zIndex!).toBeGreaterThan(edges.find(e => data(e).kind === 'allowed')!.zIndex!)
    expect(data(blocked).particle).toBe(false)
  })

  it('falls back to the circle of the zone when the address is no drawn guest of it', () => {
    const { edges } = buildZoneGraph({ zones: [web, db], flows: [], suggestions: [seen('s1', { src_ip: '10.9.9.9', dst_ip: '10.0.2.1' })], members })
    expect(edges[0].source).toBe('zone:zw')
    expect(edges[0].target).toBe('guest:zd:qemu/200')
  })

  it('draws an unknown source from the Unknown / External box, and a guest in no zone from its guest node', () => {
    const { edges } = buildZoneGraph({
      zones: [web, db], flows: [], members, unzoned: [member(900, 'lost', ['10.9.0.1'])],
      suggestions: [seen('s1', { src_zone_id: '', src_ip: '203.0.113.9', dst_ip: '10.0.2.1' }), seen('s2', { src_zone_id: '', src_ip: '10.9.0.1', dst_ip: '10.0.2.1', dport: '22' })],
    })
    expect(edges.map(e => e.source).sort()).toEqual(['external', 'guest:unzoned:qemu/900'])
  })

  it('goes to the "+N" node for a guest the circle does not draw', () => {
    const many = Array.from({ length: 20 }, (_, i) => member(300 + i, `w-${String(i).padStart(2, '0')}`, [`10.0.3.${i}`]))
    const { edges } = buildZoneGraph({ zones: [web, db], flows: [], members: new Map([['zw', many], ['zd', []]]), suggestions: [seen('s1', { src_ip: '10.0.3.19' })] })
    expect(edges[0].source).toBe('more:zw')
  })

  it('ignores observed flows that are not pending, or whose destination is not a zone', () => {
    const { edges } = buildZoneGraph({ zones: [web, db], flows: [], suggestions: [seen('s1', { status: 'accepted' }), seen('s2', { status: 'dismissed' }), seen('s3', { dst_zone_id: '' })] })
    expect(edges).toHaveLength(0)
  })
})

describe('guest addresses', () => {
  it('writes one address one way: no prefix length, IPv6 lowercased and zero-compressed, IPv4-mapped as IPv4', () => {
    expect(bareIp(' 10.0.0.5/24 ')).toBe('10.0.0.5')
    expect(bareIp('2001:DB8:0:0:0:0:0:1/64')).toBe('2001:db8::1')
    expect(bareIp('2001:db8::0:1')).toBe('2001:db8::1')
    expect(bareIp('2001:0db8:0000:0001:0000:0000:0000:0001')).toBe('2001:db8:0:1::1')
    expect(bareIp('fe80::1%eth0')).toBe('fe80::1')
    expect(bareIp('::FFFF:10.0.0.5')).toBe('10.0.0.5')
    expect(bareIp('::ffff:a00:5')).toBe('10.0.0.5')
    expect(bareIp('64:ff9b::192.0.2.33')).toBe('64:ff9b::c000:221')
    expect(bareIp('::')).toBe('::')
    expect(bareIp('not:an:ip::x')).toBe('not:an:ip::x')
  })

  const twoZones = (zw: MapMember[]) => buildZoneGraph({
    zones: [web, db], flows: [], members: new Map([['zw', zw], ['zd', [member(200, 'db-1', ['fd00::2'])]]]),
    suggestions: [seen('s1', { src_ip: '10.0.1.9', dst_ip: 'FD00:0:0::2' })],
  })

  it('gives an address two guests share to the first by name, whatever the order of the inventory', () => {
    const a = member(101, 'alpha', ['10.0.1.9'])
    const b = member(100, 'beta', ['10.0.1.9'])
    expect(twoZones([b, a]).edges[0].source).toBe('guest:zw:qemu/101')
    expect(twoZones([a, b]).edges[0].source).toBe('guest:zw:qemu/101')
  })

  it('finds a guest by any of its addresses, IPv6 written another way included', () => {
    const { edges } = twoZones([member(100, 'web-1', ['192.168.1.1', '10.0.1.9/16', '2001:db8::5'])])
    expect(edges[0].source).toBe('guest:zw:qemu/100')
    expect(edges[0].target).toBe('guest:zd:qemu/200')
    const v6 = buildZoneGraph({
      zones: [web, db], flows: [], members: new Map([['zw', [member(100, 'web-1', ['2001:db8::5'])]], ['zd', []]]),
      suggestions: [seen('s1', { src_ip: '2001:DB8:0:0::5' })],
    })
    expect(v6.edges[0].source).toBe('guest:zw:qemu/100')
  })
})

describe('filters and focus', () => {
  const members = new Map([['zw', [member(100, 'web-1', ['10.0.1.1'])]], ['zd', [member(200, 'db-1', ['10.0.2.1'])]], ['za', []]])
  const graph = buildZoneGraph({
    zones: [web, db, app], members,
    flows: [flow('f1'), flow('f2', { src_zone_id: 'zd', dst_zone_id: 'za' }), flow('f3', { dst_zone_id: '', dst_cidr: '1.1.1.1/32' })],
    suggestions: [seen('s1', { src_ip: '10.0.1.1', dst_ip: '10.0.2.1' }), seen('s2', { kind: 'blocked', src_ip: '10.0.1.1', dst_ip: '10.0.2.1', dport: '22' })],
  })
  const kinds = (edges: Edge[]) => edges.map(e => data(e).kind).sort()

  it('lets through the kinds the three checkboxes keep, the flows to Outside with the allowed ones', () => {
    expect(kinds(filterEdges(graph.edges, ALL_FLOWS))).toEqual(['allowed', 'allowed', 'blocked', 'outside', 'unprotected'])
    expect(kinds(filterEdges(graph.edges, { ...ALL_FLOWS, allowed: false }))).toEqual(['blocked', 'unprotected'])
    expect(kinds(filterEdges(graph.edges, { ...ALL_FLOWS, unprotected: false }))).toEqual(['allowed', 'allowed', 'blocked', 'outside'])
    expect(kinds(filterEdges(graph.edges, { ...ALL_FLOWS, blocked: false }))).toEqual(['allowed', 'allowed', 'outside', 'unprotected'])
  })

  it('keeps a zone, its guests, its edges and their ends lit, nothing else', () => {
    const f = focusSets(graph, 'zone:za')!
    expect([...f.edges]).toEqual(['allowed:zone:zd>zone:za'])
    expect([...f.nodes].sort()).toEqual(['zone:za', 'zone:zd'])
    const w = focusSets(graph, 'zone:zw')!
    expect(w.nodes.has('guest:zw:qemu/100')).toBe(true)
    expect(w.nodes.has('guest:zd:qemu/200')).toBe(true)
    expect(w.nodes.has('outside')).toBe(true)
    expect(w.nodes.has('zone:za')).toBe(false)
  })

  it('keeps a guest, its edges, their ends and the circles of those lit', () => {
    const f = focusSets(graph, 'guest:zd:qemu/200')!
    expect([...f.edges].sort()).toEqual(['blocked:guest:zw:qemu/100>guest:zd:qemu/200', 'unprotected:guest:zw:qemu/100>guest:zd:qemu/200'])
    expect([...f.nodes].sort()).toEqual(['guest:zd:qemu/200', 'guest:zw:qemu/100', 'zone:zd', 'zone:zw'])
  })

  it('keeps an edge and its ends lit, and nothing is dimmed without a focus', () => {
    const f = focusSets(graph, 'allowed:zone:zw>zone:zd')!
    expect([...f.nodes].sort()).toEqual(['zone:zd', 'zone:zw'])
    expect(focusSets(graph, null)).toBeNull()
    expect(focusSets(graph, 'nothing')).toBeNull()
  })
})

describe('groupServices', () => {
  it('groups the ports of one protocol after its name, several protocols apart, ports in numeric order', () => {
    expect(groupServices(['tcp/8080', 'tcp/22'])).toBe('tcp/22, 8080')
    expect(groupServices(['udp/53', 'tcp/5432'])).toBe('tcp 5432 · udp 53')
    expect(groupServices(['icmp', 'tcp/443', 'tcp/80'])).toBe('icmp · tcp 80, 443')
    expect(groupServices(['tcp/80,443', 'tcp/8000-8100'])).toBe('tcp/80, 443, 8000-8100')
    expect(groupServices(['icmp'])).toBe('icmp')
  })
})

describe('layout', () => {
  const zones = [web, db, app, zone('zc', 'cache'), zone('zq', 'queue')]
  const flows = [flow('f1', { dst_zone_id: 'za' }), flow('f2', { src_zone_id: 'za', dst_zone_id: 'zd' }), flow('f3', { src_cidr: '10.0.0.0/8', src_zone_id: '', dst_zone_id: 'zw' }), flow('f4', { src_zone_id: 'zd', dst_zone_id: '', dst_cidr: '8.8.8.8/32' })]

  it('is deterministic and does not depend on the order of the lists', () => {
    const a = buildZoneGraph({ zones, flows, suggestions: [] })
    const b = buildZoneGraph({ zones: [...zones].reverse(), flows: [...flows].reverse(), suggestions: [] })
    const sort = <T extends { id: string }>(l: T[]) => [...l].sort((x, y) => x.id.localeCompare(y.id))
    expect(sort(b.nodes)).toEqual(sort(a.nodes))
    expect(sort(b.edges)).toEqual(sort(a.edges))
  })

  it('reads left to right: External, then the zones by the column of their flows, Outside last', () => {
    const { nodes } = buildZoneGraph({ zones, flows, suggestions: [] })
    const x = (id: string) => { const n = byId(nodes, id); return n.position.x + (n.width ?? NODE_W) / 2 }
    expect(x('external')).toBeLessThan(x('zone:zw'))
    expect(x('zone:zw')).toBeLessThan(x('zone:za'))
    expect(x('zone:za')).toBeLessThan(x('zone:zd'))
    expect(x('zone:zd')).toBeLessThan(x('outside'))
    expect(x('zone:zc')).toBe(x('zone:zw'))
  })

  it.each([1, 3, 8, 20])('never lays two of %i circles on top of each other', count => {
    const many = Array.from({ length: count }, (_, i) => zone(`z${i}`, `zone-${String(i).padStart(2, '0')}`))
    const { nodes } = buildZoneGraph({ zones: many, flows: [], suggestions: [] })
    for (const [i, a] of nodes.entries()) {
      for (const b of nodes.slice(i + 1)) {
        const d = Math.hypot(a.position.x + a.width! / 2 - b.position.x - b.width! / 2, a.position.y + a.height! / 2 - b.position.y - b.height! / 2)
        expect(d, `${a.id} / ${b.id}`).toBeGreaterThan(a.width! / 2 + b.width! / 2)
      }
    }
  })
})

/** The demo-like map: 6 zones (8/8/6/4/4/2 members), External, the guests in no zone, Outside, 12 allowed flows, observed pairs. */
function demoGraph() {
  const names: Array<[string, string, number]> = [['zw', 'web', 8], ['zad', 'admin', 8], ['za', 'app', 6], ['zd', 'db', 4], ['zc', 'cache', 4], ['zm', 'monitoring', 2]]
  const zones = names.map(([id, name]) => zone(id, name))
  const members = new Map(names.map(([id, name, n], z) => [id, Array.from({ length: n }, (_, i) => member(100 * (z + 1) + i, `${name}-${i + 1}`, [`10.0.${z + 1}.${i + 1}`]))]))
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
    seen('s1', { src_zone_id: 'zw', src_ip: '10.0.1.1', dst_zone_id: 'zd', dst_ip: '10.0.4.1', dport: '5432' }),
    seen('s2', { src_zone_id: 'zad', src_ip: '10.0.2.2', dst_zone_id: 'zc', dst_ip: '10.0.5.1', dport: '6379' }),
    seen('s3', { kind: 'blocked', src_zone_id: '', src_ip: '203.0.113.9', dst_zone_id: 'zw', dst_ip: '10.0.1.3', dport: '3389' }),
    seen('s4', { src_zone_id: '', src_ip: '10.9.0.1', dst_zone_id: 'za', dst_ip: '10.0.3.2', dport: '8080' }),
  ]
  const unzoned = [member(900, 'lost-1', ['10.9.0.1']), member(901, 'lost-2'), member(902, 'lost-3')]
  return buildZoneGraph({ zones, flows, suggestions, members, unzoned })
}

describe('the demo-like map is readable', () => {
  const graph = demoGraph()
  const abs = new Map<string, { x: number; y: number }>()
  for (const n of graph.nodes) {
    const p = n.parentId ? abs.get(n.parentId)! : { x: 0, y: 0 }
    abs.set(n.id, { x: p.x + n.position.x, y: p.y + n.position.y })
  }
  const tops = graph.nodes.filter(n => !n.parentId)
  const circles = tops.filter(n => n.type !== 'boundary').map(n => ({ id: n.id, c: { x: abs.get(n.id)!.x + n.width! / 2, y: abs.get(n.id)!.y + n.height! / 2 }, r: n.width! / 2 }))
  const boxes = tops.filter(n => n.type === 'boundary').map(n => ({ id: n.id, c: { x: abs.get(n.id)!.x + NODE_W / 2, y: abs.get(n.id)!.y + NODE_H / 2 } }))
  const groupOf = (id: string) => graph.nodes.find(n => n.id === id)!.parentId ?? id

  it('has the nodes and edges it should', () => {
    expect(tops.map(n => n.id).sort()).toEqual(['external', 'outside', 'unzoned', 'zone:za', 'zone:zad', 'zone:zc', 'zone:zd', 'zone:zm', 'zone:zw'])
    expect(graph.nodes.filter(n => n.type === 'guest')).toHaveLength(8 + 8 + 6 + 4 + 4 + 2 + 3)
    expect(graph.edges.filter(e => ['allowed', 'outside'].includes(data(e).kind))).toHaveLength(11)
    expect(graph.edges.filter(e => ['unprotected', 'blocked'].includes(data(e).kind))).toHaveLength(4)
  })

  it('reads External -> web/admin/monitoring -> app -> db/cache -> Outside', () => {
    const cx = (id: string) => circles.find(c => c.id === id)?.c.x ?? boxes.find(b => b.id === id)!.c.x
    expect(cx('external')).toBeLessThan(cx('zone:zw'))
    expect(cx('zone:zw')).toBe(cx('zone:zad'))
    expect(cx('zone:zw')).toBe(cx('zone:zm'))
    expect(cx('zone:zw')).toBeLessThan(cx('zone:za'))
    expect(cx('zone:za')).toBeLessThan(cx('zone:zd'))
    expect(cx('zone:zd')).toBe(cx('zone:zc'))
    expect(cx('zone:zd')).toBeLessThan(cx('outside'))
  })

  it('lays no circle or box on another, and no guest on another', () => {
    for (const [i, a] of circles.entries()) {
      for (const b of circles.slice(i + 1)) expect(Math.hypot(a.c.x - b.c.x, a.c.y - b.c.y), `${a.id} ${b.id}`).toBeGreaterThan(a.r + b.r + 40)
      for (const b of boxes) expect(rectHitsCircle(rectAround(b.c, NODE_W, NODE_H), a.c, a.r, 20), `${a.id} ${b.id}`).toBe(false)
    }
    const guests = graph.nodes.filter(n => n.parentId)
    for (const [i, a] of guests.entries()) {
      for (const b of guests.slice(i + 1)) {
        const [pa, pb] = [abs.get(a.id)!, abs.get(b.id)!]
        expect(Math.abs(pa.x - pb.x) >= GUEST_W || Math.abs(pa.y - pb.y) >= GUEST_H, `${a.id} ${b.id}`).toBe(true)
      }
    }
  })

  it('draws no edge through a circle or a box it does not belong to', () => {
    const crossings: string[] = []
    for (const e of graph.edges) {
      const d = data(e)
      const own = new Set([groupOf(e.source), groupOf(e.target)])
      for (const c of circles) if (!own.has(c.id) && crossesCircle(d.points, c.c, c.r, 0)) crossings.push(`${e.id} through ${c.id}`)
      for (const b of boxes) if (!own.has(b.id) && crossesBox(d.points, b.c, NODE_W / 2, NODE_H / 2, 0)) crossings.push(`${e.id} through ${b.id}`)
    }
    expect(crossings).toEqual([])
  })

  it('starts and ends every edge on its own nodes', () => {
    for (const e of graph.edges) {
      const d = data(e)
      const at = (id: string) => {
        const n = graph.nodes.find(x => x.id === id)!
        const p = abs.get(id)!
        return n.parentId ? { x: p.x + GUEST_W / 2, y: p.y + GLYPH_Y, r: GUEST_R } : n.type === 'boundary' ? null : { x: p.x + n.width! / 2, y: p.y + n.height! / 2, r: n.width! / 2 }
      }
      for (const [id, point] of [[e.source, d.points[0]], [e.target, d.points[d.points.length - 1]]] as const) {
        const end = at(id)
        if (end) expect(Math.abs(Math.hypot(point.x - end.x, point.y - end.y) - end.r), `${e.id} at ${id}`).toBeLessThan(16)
      }
    }
  })

  it('lays no label on another label, on a circle or on a box', () => {
    const rects: Array<[string, Rect]> = graph.edges.map(e => [e.id, rectAround({ x: data(e).label_x, y: data(e).label_y }, data(e).label_w, data(e).label_h)])
    const problems: string[] = []
    for (const [i, [id, r]] of rects.entries()) {
      for (const [other, s] of rects.slice(i + 1)) if (rectsOverlap(r, s)) problems.push(`${id} / ${other}`)
      for (const c of circles) if (rectHitsCircle(r, c.c, c.r)) problems.push(`${id} on ${c.id}`)
      for (const b of boxes) if (rectsOverlap(r, rectAround(b.c, NODE_W, NODE_H))) problems.push(`${id} on ${b.id}`)
    }
    expect(problems).toEqual([])
  })
})
