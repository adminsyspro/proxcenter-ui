/**
 * The map of a policy shared by several clusters, model side: the guests of every cluster in their zones (two guests
 * of one type and VMID on two clusters stay two guests), the node view grouped per cluster, the exceptions matched in
 * their own cluster, the flows between two clusters drawn like the others. A policy of one cluster keeps its keys.
 */

import { describe, expect, it } from 'vitest'

import type { Node } from '@xyflow/react'

import { buildGuestView, buildZoneInside } from './guestViewModel'
import { mapGuests, mapKey, mapPveNodes } from './mapClusters'
import { exception, flow, member, seen, zone } from './mapViewsTestKit'
import { buildNodeView } from './nodeViewModel'
import { targetCandidates, targetNodeId } from './targetModel'
import {
  buildZoneGraph, exceptionLinks, pveClusterId, pveNodeId, pveNodeName,
  type MapCluster, type MapEdgeData, type MapInput, type MapMember, type PveClusterData, type PveNodeData, type ZoneGraph,
} from './zoneGraph'
import { GLYPH_Y, GUEST_R } from './zoneLayout'
import type { PolicyGuest, ZoneMember } from './zoneModel'

const PROD: MapCluster = { id: 'c1', name: 'PVE-PROD' }
const DR: MapCluster = { id: 'c2', name: 'PVE-DR' }
const LAB: MapCluster = { id: 'c3', name: 'PVE-LAB3' }

/** A guest of a cluster on the map: keyed by its cluster, type and VMID. */
const on = (cluster: MapCluster, vmid: number, name: string, ips: string[] = [], over: Partial<MapMember> = {}): MapMember =>
  member(vmid, name, ips, { key: `${cluster.id}/qemu/${vmid}`, cluster, ...over })

/** web holds 100 on PROD and 100 on DR (the same VMID), db holds 200 on DR; lost-1 is in no zone on LAB3. */
function shared(over: Partial<MapInput> = {}): MapInput {
  return {
    zones: [zone('zw', 'web'), zone('zd', 'db')],
    flows: [flow('f1', { src_zone_id: 'zw', dst_zone_id: 'zd' })],
    suggestions: [],
    members: new Map([
      ['zw', [on(PROD, 100, 'web-prod', ['10.0.1.1']), on(DR, 100, 'web-dr', ['10.0.1.2'], { node: 'pve1' })]],
      ['zd', [on(DR, 200, 'db-dr', ['10.0.4.1'], { node: 'pve2' })]],
    ]),
    unzoned: [on(LAB, 900, 'lost-1', ['10.9.0.1'], { node: 'lab3' })],
    clusters: [PROD, DR, LAB],
    ...over,
  }
}

const ids = (nodes: Node[], parent: string) => nodes.filter(n => n.parentId === parent).map(n => n.id)
const dataOf = <T>(nodes: Node[], id: string) => nodes.find(n => n.id === id)!.data as unknown as T

describe('the map key of a guest', () => {
  it.each([
    ['a policy of one cluster: type and VMID, as it always was', false, 'qemu/100'],
    ['a shared policy: the cluster first, so the same VMID on two clusters is two guests', true, 'c2/qemu/100'],
  ])('%s', (_name, isShared, key) => {
    expect(mapKey({ connectionId: 'c2', type: 'qemu', vmid: 100 }, isShared)).toBe(key)
  })

  it('reads the node name back from a node of a cluster and from a node of a policy of one cluster', () => {
    expect(pveNodeId('pve1')).toBe('pve:pve1')
    expect(pveNodeId('pve1', 'c2')).toBe('pve:c2/pve1')
    expect(pveNodeName(pveNodeId('pve1'))).toBe('pve1')
    expect(pveNodeName(pveNodeId('pve1', 'c2'))).toBe('pve1')
  })
})

describe('the guests of every cluster, from the inventory to the map', () => {
  const guest = (connectionId: string, vmid: number, name: string, over: Partial<PolicyGuest> = {}): PolicyGuest =>
    ({ connectionId, vmid, name, node: 'pve1', type: 'qemu', status: 'running', tags: [], ips: [], ...over })
  const memberOf = (g: PolicyGuest): ZoneMember => ({ connectionId: g.connectionId, ref: { node: g.node, type: g.type, vmid: g.vmid }, guest: g, pending: false })
  const prod100 = guest('c1', 100, 'web-prod')
  const dr100 = guest('c2', 100, 'web-dr')
  const dr101 = guest('c2', 101, 'idle-dr')
  const lab900 = guest('c3', 900, 'lost-1', { node: 'lab3' })
  const zones = new Map([['zw', [memberOf(prod100), memberOf(dr100)]]])
  const name = (id: string) => [PROD, DR, LAB].find(c => c.id === id)!

  it('keeps two guests of one VMID on two clusters apart, each with its cluster', () => {
    const { members, unzoned } = mapGuests(zones, [prod100, dr100, dr101, lab900], name)
    expect(members.get('zw')!.map(m => [m.key, m.name, m.cluster?.name])).toEqual([
      ['c1/qemu/100', 'web-prod', 'PVE-PROD'], ['c2/qemu/100', 'web-dr', 'PVE-DR'],
    ])
    // dr101 shares no key with a member: in no zone, like lost-1 of the standalone node.
    expect(unzoned.map(m => m.key)).toEqual(['c2/qemu/101', 'c3/qemu/900'])
  })

  it('keeps the keys of a policy of one cluster and gives no cluster', () => {
    const one = new Map([['zw', [memberOf(prod100)]]])
    const { members, unzoned } = mapGuests(one, [prod100, guest('c1', 101, 'idle')], null)
    expect(members.get('zw')!.map(m => [m.key, m.cluster])).toEqual([['qemu/100', undefined]])
    expect(unzoned.map(m => m.key)).toEqual(['qemu/101'])
  })

  it('lists the Proxmox nodes of each cluster with its own guests, the same node name on two clusters twice', () => {
    const nodes = mapPveNodes([prod100, dr100, dr101, lab900], [
      { id: 'c1', nodes: ['pve1', 'pve3'], status: { pve1: 'online', pve3: 'offline' } },
      { id: 'c2', nodes: ['pve1'], status: { pve1: 'online' } },
      { id: 'c3' },
    ], true)
    expect(nodes).toEqual([
      { node: 'pve1', guests: 1, status: 'online', cluster: 'c1' },
      { node: 'pve3', guests: 0, status: 'offline', cluster: 'c1' },
      { node: 'pve1', guests: 2, status: 'online', cluster: 'c2' },
      // A cluster whose node list the page did not read: the nodes of its guests.
      { node: 'lab3', guests: 1, status: undefined, cluster: 'c3' },
    ])
  })

  it('lists the nodes of a policy of one cluster as the map always did: the page\'s nodes first, then those of the guests', () => {
    const nodes = mapPveNodes([prod100, guest('c1', 102, 'x', { node: 'pve9' })], [{ id: 'c1', nodes: ['pve2', 'pve1'], status: { pve2: 'online', pve9: 'offline' } }], false)
    expect(nodes).toEqual([
      { node: 'pve2', guests: 0, status: 'online' },
      { node: 'pve1', guests: 1, status: undefined },
      { node: 'pve9', guests: 1, status: 'offline' },
    ])
  })
})

describe('the zone view of a shared policy', () => {
  it('holds in a zone circle its members of every cluster, the same VMID twice, and counts them all', () => {
    const g = buildZoneGraph(shared())
    // By name: web-dr (DR) before web-prod (PROD).
    expect(ids(g.nodes, 'zone:zw')).toEqual(['guest:zw:c2/qemu/100', 'guest:zw:c1/qemu/100'])
    expect(dataOf<{ members: number }>(g.nodes, 'zone:zw').members).toBe(2)
    expect(ids(g.nodes, 'unzoned')).toEqual(['guest:unzoned:c3/qemu/900'])
  })

  it('draws an observed flow between guests of two clusters from guest to guest', () => {
    const g = buildZoneGraph(shared({ suggestions: [seen('s1', { src_zone_id: 'zw', src_ip: '10.0.1.1', dst_zone_id: 'zd', dst_ip: '10.0.4.1' })] }))
    expect(g.edges.map(e => e.id)).toContain('unprotected:guest:zw:c1/qemu/100>guest:zd:c2/qemu/200')
  })
})

describe('exceptions of a shared policy', () => {
  // An exception of DR's db: web-dr (c2 qemu/100) may reach db-dr; PROD's web-prod is also qemu/100 and is not named.
  const drException = exception('e1', { connection_id: 'c2', zone_id: 'zd', sources: [{ type: 'qemu', vmid: 100, name: 'web-dr' }], destinations: [{ type: 'qemu', vmid: 200, name: 'db-dr' }] })

  it('matches its guests in its own cluster only', () => {
    const input = shared({ exceptions: [drException] })
    const known = new Map(input.zones.map(z => [z.id, z]))
    const links = exceptionLinks(input.exceptions, known, input.members, input.unzoned, true)
    expect(links.map(l => [l.sourceKey, l.destinationKey, l.srcZone])).toEqual([['c2/qemu/100', 'c2/qemu/200', 'zw']])
  })

  it('finds nothing for an exception whose guests are on another cluster than its own', () => {
    const input = shared({ exceptions: [{ ...drException, connection_id: 'c1' }] })
    const known = new Map(input.zones.map(z => [z.id, z]))
    expect(exceptionLinks(input.exceptions, known, input.members, input.unzoned, true)).toEqual([])
  })

  it('draws it on the guest view between the guests of its cluster', () => {
    const g = buildGuestView({ ...shared({ exceptions: [drException] }), centre: 'zd' })
    expect(g.edges.map(e => e.id)).toContain('exception:guest:zw:c2/qemu/100>guest:zd:c2/qemu/200')
    expect(g.edges.map(e => e.id).some(id => id.includes('c1/qemu/100'))).toBe(false)
  })
})

describe('the guest view and the inside of a zone of a shared policy', () => {
  it('draws in a peer the guests of every cluster that talked to the centre', () => {
    const g = buildGuestView({
      ...shared({ suggestions: [seen('s1', { src_zone_id: 'zw', src_ip: '10.0.1.2', dst_zone_id: 'zd', dst_ip: '10.0.4.1' })] }),
      centre: 'zd',
    })
    expect(ids(g.nodes, 'zone:zd')).toEqual(['guest:zd:c2/qemu/200'])
    expect(ids(g.nodes, 'zone:zw')).toEqual(['guest:zw:c2/qemu/100'])
  })

  it('puts on the rings of an entered zone its guests of every cluster', () => {
    const g = buildZoneInside({ ...shared(), centre: 'zw' })
    // By name: web-dr (DR) before web-prod (PROD).
    expect(ids(g.nodes, 'zone:zw')).toEqual(['guest:zw:c2/qemu/100', 'guest:zw:c1/qemu/100'])
  })

  it('draws what two guests of one zone on two clusters exchange as a chord of the entered zone', () => {
    const g = buildZoneInside({ ...shared({ suggestions: [seen('s1', { src_zone_id: 'zw', src_ip: '10.0.1.1', dst_zone_id: 'zw', dst_ip: '10.0.1.2' })] }), centre: 'zw' })
    expect(g.edges.map(e => e.id)).toContain('unprotected:guest:zw:c1/qemu/100>guest:zw:c2/qemu/100')
  })
})

describe('the node view of a shared policy', () => {
  const nodesOf = (over: Partial<MapInput> = {}) => buildNodeView(shared({
    pveNodes: [
      { node: 'pve1', guests: 1, status: 'online', cluster: 'c1' },
      { node: 'pve2', guests: 0, status: 'online', cluster: 'c1' },
      { node: 'pve1', guests: 1, status: 'online', cluster: 'c2' },
      { node: 'pve2', guests: 1, status: 'offline', cluster: 'c2' },
      { node: 'lab3', guests: 1, cluster: 'c3' },
    ],
    ...over,
  }))
  const frame = (nodes: Node[], cluster: string) => nodes.find(n => n.id === pveClusterId(cluster))!
  const box = (n: Node) => ({ left: n.position.x, top: n.position.y, right: n.position.x + n.width!, bottom: n.position.y + n.height! })

  it('draws one labelled group per cluster, in the order given, behind the circles of its nodes', () => {
    const g = nodesOf()
    const frames = g.nodes.filter(n => n.type === 'pveCluster')
    expect(frames.map(n => (n.data as unknown as PveClusterData).cluster.name)).toEqual(['PVE-PROD', 'PVE-DR', 'PVE-LAB3'])
    // Drawn first: a circle is never painted under its group.
    expect(g.nodes.slice(0, 3).every(n => n.type === 'pveCluster')).toBe(true)
    expect(frames.every(n => n.focusable === false && n.selectable === false)).toBe(true)
  })

  it('draws a node name found on two clusters as two nodes, each in the group of its cluster', () => {
    const g = nodesOf()
    const circles = g.nodes.filter(n => n.type === 'pveNode').map(n => n.id)
    expect(circles).toEqual(['pve:c1/pve1', 'pve:c1/pve2', 'pve:c2/pve1', 'pve:c2/pve2', 'pve:c3/lab3'])
    expect(dataOf<PveNodeData>(g.nodes, 'pve:c2/pve1')).toMatchObject({ node: 'pve1', cluster: DR, count: 1, status: 'online' })
    expect(ids(g.nodes, 'pve:c1/pve1')).toEqual(['guest:pve:c1/pve1:c1/qemu/100'])
    expect(ids(g.nodes, 'pve:c2/pve1')).toEqual(['guest:pve:c2/pve1:c2/qemu/100'])
    for (const [cluster, members] of [['c1', ['pve:c1/pve1', 'pve:c1/pve2']], ['c2', ['pve:c2/pve1', 'pve:c2/pve2']], ['c3', ['pve:c3/lab3']]] as const) {
      const outer = box(frame(g.nodes, cluster))
      for (const id of members) {
        const inner = box(g.nodes.find(n => n.id === id)!)
        expect(inner.left).toBeGreaterThan(outer.left)
        expect(inner.right).toBeLessThan(outer.right)
        expect(inner.top).toBeGreaterThan(outer.top)
        expect(inner.bottom).toBeLessThan(outer.bottom)
      }
    }
  })

  it('never lets two groups overlap', () => {
    const [a, b, c] = ['c1', 'c2', 'c3'].map(id => box(frame(nodesOf().nodes, id)))
    expect(a.right).toBeLessThan(b.left)
    expect(b.right).toBeLessThan(c.left)
  })

  it('draws the flows between nodes of two clusters, and keeps inside a node only what stays in that node', () => {
    const g = nodesOf({
      suggestions: [
        // web-prod (PROD pve1) to db-dr (DR pve2), and web-dr (DR pve1) to db-dr (DR pve2).
        seen('s1', { src_zone_id: 'zw', src_ip: '10.0.1.1', dst_zone_id: 'zd', dst_ip: '10.0.4.1' }),
        seen('s2', { src_zone_id: 'zw', src_ip: '10.0.1.2', dst_zone_id: 'zd', dst_ip: '10.0.4.1', kind: 'blocked' }),
      ],
    })
    expect(g.edges.map(e => e.id).sort()).toEqual(['blocked:pve:c2/pve1>pve:c2/pve2', 'unprotected:pve:c1/pve1>pve:c2/pve2'])
    // pve1 of PROD and pve1 of DR are two nodes: the flow between them is no flow inside a node.
    expect(dataOf<PveNodeData>(g.nodes, 'pve:c1/pve1').inside).toBe(0)
  })

  it('draws no group and keeps the node IDs of a policy of one cluster', () => {
    const g = buildNodeView({
      ...shared(),
      clusters: undefined,
      members: new Map([['zw', [member(100, 'web-1', [], { node: 'pve1' })]]]),
      unzoned: [],
      pveNodes: [{ node: 'pve1', guests: 1 }, { node: 'pve2', guests: 0 }],
    })
    expect(g.nodes.some(n => n.type === 'pveCluster')).toBe(false)
    expect(g.nodes.filter(n => !n.parentId).map(n => n.id)).toEqual(['pve:pve1', 'pve:pve2'])
    expect(dataOf<PveNodeData>(g.nodes, 'pve:pve1').cluster).toBeUndefined()
  })
})

describe('a guest targeted on a shared policy', () => {
  const guest = (connectionId: string, vmid: number, name: string): PolicyGuest =>
    ({ connectionId, vmid, name, node: 'pve1', type: 'qemu', status: 'running', tags: [], ips: [] })

  it('is keyed by its cluster on the map, so the same VMID on another cluster is another target', () => {
    const list = targetCandidates([guest('c1', 100, 'web-prod'), guest('c2', 100, 'web-dr')], new Map(), true)
    expect(list.map(c => c.key)).toEqual(['c2/qemu/100', 'c1/qemu/100'])
    expect(targetCandidates([guest('c1', 100, 'web-prod')], new Map())[0].key).toBe('qemu/100')
  })

  it('finds its glyph in the circle of its node of its own cluster on the node view', () => {
    const g = buildNodeView(shared({ pveNodes: [] }))
    const [dr] = targetCandidates([guest('c2', 100, 'web-dr')], new Map([['zw', [{ connectionId: 'c2', ref: { node: 'pve1', type: 'qemu', vmid: 100 }, guest: null, pending: false }]]]), true)
    expect(targetNodeId(g, dr)).toBe('guest:pve:c2/pve1:c2/qemu/100')
  })
})

/**
 * How far each end of each edge is from the outline of the node it links, as the edge component receives it (its
 * points): a guest or a "+N" by its glyph, a circle by its rim, a box by its sides. 0 on the outline or inside it.
 */
function endGaps(g: ZoneGraph): Array<{ id: string; from: number; to: number }> {
  const byId = new Map(g.nodes.map(n => [n.id, n]))
  const gap = (id: string, p: { x: number; y: number }) => {
    const n = byId.get(id)!
    if (n.parentId) {
      const parent = byId.get(n.parentId)!
      const c = { x: parent.position.x + n.position.x + n.width! / 2, y: parent.position.y + n.position.y + GLYPH_Y }
      return Math.max(0, Math.hypot(p.x - c.x, p.y - c.y) - GUEST_R)
    }
    const c = { x: n.position.x + n.width! / 2, y: n.position.y + n.height! / 2 }
    if (n.type === 'zone' || n.type === 'unzoned' || n.type === 'pveNode') return Math.max(0, Math.hypot(p.x - c.x, p.y - c.y) - n.width! / 2)
    return Math.max(0, Math.abs(p.x - c.x) - n.width! / 2, Math.abs(p.y - c.y) - n.height! / 2)
  }
  return g.edges.map(e => {
    const { points } = e.data as unknown as MapEdgeData
    return { id: e.id, from: Math.round(gap(e.source, points[0])), to: Math.round(gap(e.target, points.at(-1)!)) }
  })
}

describe('the ends of the edges of a shared policy', () => {
  // db holds 8 guests of PROD and DR; 14 guests in no zone (7 per cluster, a "+N" past 11) each talk to another guest
  // of db, all blocked; two guests of db talk to each other both ways, and the allowed flows stay zone to zone.
  const cluster = (i: number) => (i % 2 ? DR : PROD)
  const dbMembers = Array.from({ length: 8 }, (_, i) => on(cluster(i), 300 + i, `db-${i}`, [`10.0.4.${i + 1}`], { node: `pve${(i % 3) + 1}` }))
  const lost = Array.from({ length: 14 }, (_, i) => on(cluster(i), 900 + i, `lost-${String(i).padStart(2, '0')}`, [`10.9.0.${i + 1}`], { node: `pve${(i % 3) + 1}` }))
  const blocked = lost.map((m, i) => seen(`b${i}`, { kind: 'blocked', src_zone_id: '', src_ip: m.ips[0], dst_zone_id: 'zd', dst_ip: `10.0.4.${(i % 8) + 1}`, dport: String(5000 + i) }))
  const chords = [
    seen('c1', { src_zone_id: 'zd', src_ip: '10.0.4.1', dst_zone_id: 'zd', dst_ip: '10.0.4.2' }),
    seen('c2', { src_zone_id: 'zd', src_ip: '10.0.4.2', dst_zone_id: 'zd', dst_ip: '10.0.4.1' }),
    seen('c3', { kind: 'blocked', src_zone_id: 'zd', src_ip: '10.0.4.1', dst_zone_id: 'zd', dst_ip: '10.0.4.2', dport: '22' }),
  ]
  const input = shared({
    members: new Map([['zw', [on(PROD, 100, 'web-prod', ['10.0.1.1'])]], ['zd', dbMembers]]),
    unzoned: lost,
    suggestions: [...blocked, ...chords, seen('w1', { src_zone_id: 'zw', src_ip: '10.0.1.1', dst_zone_id: 'zd', dst_ip: '10.0.4.3' })],
    flows: [flow('f1', { src_zone_id: 'zw', dst_zone_id: 'zd' }), flow('f2', { src_zone_id: '', src_cidr: '0.0.0.0/0', dst_zone_id: 'zd' })],
  })
  // An edge stops 4 px short of the outline it leaves or reaches (GAP): within a few px is on it.
  const far = (g: ZoneGraph) => endGaps(g).filter(e => e.from > 5 || e.to > 5)

  it('starts and ends every edge of the guest view on the guests (or "+N") it links, however many share two circles', () => {
    const g = buildGuestView({ ...input, centre: 'zd' })
    expect(g.edges.filter(e => e.source.startsWith('guest:unzoned:') || e.source === 'more:unzoned').length).toBeGreaterThan(8)
    expect(far(g)).toEqual([])
  })

  it('keeps two edges between the same two guests apart, each still on both guests', () => {
    const g = buildZoneInside({ ...input, centre: 'zd' })
    // db-0 (PROD 300) and db-1 (DR 301): unprotected both ways and blocked one way, three edges between the same two guests.
    const pair = new Set(['guest:zd:c1/qemu/300', 'guest:zd:c2/qemu/301'])
    const between = g.edges.filter(e => pair.has(e.source) && pair.has(e.target))
    expect(between).toHaveLength(3)
    expect(far(g)).toEqual([])
    const mids = between.map(e => (e.data as unknown as MapEdgeData).points[24])
    for (const [a, b] of [[0, 1], [0, 2], [1, 2]]) expect(Math.hypot(mids[a].x - mids[b].x, mids[a].y - mids[b].y)).toBeGreaterThan(4)
  })

  it('ends every edge of the groups and node views on its nodes', () => {
    expect(far(buildZoneGraph(input))).toEqual([])
    expect(far(buildNodeView(input))).toEqual([])
  })
})
