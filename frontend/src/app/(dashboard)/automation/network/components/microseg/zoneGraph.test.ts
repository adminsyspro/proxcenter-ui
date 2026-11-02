/**
 * buildZoneGraph is pure: zones, flows and pending would-block suggestions in,
 * React Flow nodes and edges out, with positions that only depend on the input.
 */

import { describe, expect, it } from 'vitest'

import type { MicrosegFlow, MicrosegSuggestion, MicrosegZone } from '@/lib/microseg/types'

import { NODE_H, NODE_W, buildZoneGraph, type BoundaryNodeData, type MapEdgeData, type ZoneNodeData } from './zoneGraph'

const zone = (id: string, name: string, over: Partial<MicrosegZone> = {}): MicrosegZone => ({
  id, policy_id: 'p1', name, label: '', color: '#3b82f6', enforcement: 'guest', vnet_id: '', state: 'observe',
  isolate_members: false, observe_since: null, ...over,
})

const flow = (id: string, over: Partial<MicrosegFlow> = {}): MicrosegFlow => ({
  id, policy_id: 'p1', src_zone_id: 'zw', src_cidr: '', dst_zone_id: 'zd', dst_cidr: '', proto: 'tcp', dport: '443',
  comment: '', origin: 'manual', created_by: 'me', ...over,
})

const suggestion = (id: string, over: Partial<MicrosegSuggestion> = {}): MicrosegSuggestion => ({
  id, policy_id: 'p1', kind: 'would_block', src_key: 'k', src_ip: '10.0.0.1', src_zone_id: 'zw', dst_ip: '10.0.0.2', dst_zone_id: 'zd',
  proto: 'tcp', dport: '80', hits: 3, first_seen: '2026-11-02T10:00:00Z', last_seen: '2026-11-02T11:00:00Z', status: 'pending', ...over,
})

const web = zone('zw', 'web')
const db = zone('zd', 'db')
const app = zone('za', 'app')

const edgeData = (e: { data?: unknown }) => e.data as MapEdgeData

describe('buildZoneGraph nodes', () => {
  it('builds one node per zone and one edge per zone pair', () => {
    const { nodes, edges } = buildZoneGraph(
      [web, db, app],
      [flow('f1'), flow('f2', { proto: 'udp', dport: '53' }), flow('f3', { src_zone_id: 'zd', dst_zone_id: 'za', dport: '5432' })],
      [],
    )
    expect(nodes).toHaveLength(3)
    expect(nodes.every(n => n.type === 'zone')).toBe(true)
    expect(edges).toHaveLength(2)
    const wd = edges.find(e => e.source === 'zone:zw' && e.target === 'zone:zd')!
    expect(edgeData(wd).kind).toBe('flow')
    expect(edgeData(wd).services).toEqual(['tcp/443', 'udp/53'])
    expect(wd.style?.strokeDasharray).toBeUndefined()
  })

  it('keeps the two directions of a pair as two edges', () => {
    const { edges } = buildZoneGraph([web, db], [flow('f1'), flow('f2', { src_zone_id: 'zd', dst_zone_id: 'zw' })], [])
    expect(edges).toHaveLength(2)
    expect(edges.map(e => `${e.source}>${e.target}`).sort()).toEqual(['zone:zd>zone:zw', 'zone:zw>zone:zd'])
  })

  it('describes a zone node with its zone, its member count and its state', () => {
    const { nodes } = buildZoneGraph([web, zone('zd', 'db', { state: 'enforce' })], [], [], new Map([['zw', 4]]))
    const w = nodes.find(n => n.id === 'zone:zw')!.data as unknown as ZoneNodeData
    const d = nodes.find(n => n.id === 'zone:zd')!.data as unknown as ZoneNodeData
    expect(w).toMatchObject({ kind: 'zone', members: 4, state: 'observe' })
    expect(w.zone.id).toBe('zw')
    expect(d.state).toBe('enforce')
    expect(d.members).toBe(0)
  })

  it('has no member count while the guests are unknown', () => {
    const { nodes } = buildZoneGraph([web], [], [])
    expect((nodes[0].data as unknown as ZoneNodeData).members).toBeNull()
  })

  it('draws a graph with no zone and no edge', () => {
    expect(buildZoneGraph([], [], [])).toEqual({ nodes: [], edges: [] })
  })

  it('ignores a flow whose zone is gone', () => {
    const { edges, nodes } = buildZoneGraph([web], [flow('f1')], [])
    expect(edges).toHaveLength(0)
    expect(nodes).toHaveLength(1)
  })
})

describe('buildZoneGraph pending would-block suggestions', () => {
  it('adds a dashed red edge for pending would_block suggestions', () => {
    const { edges } = buildZoneGraph([web, db], [], [suggestion('s1'), suggestion('s2', { dport: '22' })])
    expect(edges).toHaveLength(1)
    const [e] = edges
    expect(edgeData(e)).toMatchObject({ kind: 'pending', services: ['tcp/22', 'tcp/80'], count: 2 })
    expect(e.style?.strokeDasharray).toBeTruthy()
    expect(e.style?.stroke).toBe('#f44336')
    expect(e.source).toBe('zone:zw')
    expect(e.target).toBe('zone:zd')
  })

  it('keeps the solid and the red edge of the same pair apart', () => {
    const { edges } = buildZoneGraph([web, db], [flow('f1')], [suggestion('s1')])
    expect(edges).toHaveLength(2)
    expect(new Set(edges.map(e => edgeData(e).offset)).size).toBe(2)
  })

  it('ignores suggestions that are not pending would_block, or whose destination is not a zone', () => {
    const { edges } = buildZoneGraph([web, db], [], [
      suggestion('s1', { kind: 'blocked' }),
      suggestion('s2', { status: 'accepted' }),
      suggestion('s3', { status: 'dismissed' }),
      suggestion('s4', { dst_zone_id: '' }),
    ])
    expect(edges).toHaveLength(0)
  })

  it('never animates a red edge', () => {
    const { edges } = buildZoneGraph([web, db], [flow('f1')], [suggestion('s1')])
    expect(edges.map(e => [edgeData(e).kind, edgeData(e).particle])).toEqual(expect.arrayContaining([['flow', true], ['pending', false]]))
  })
})

describe('buildZoneGraph outside the zones', () => {
  it('adds an External node for a CIDR source', () => {
    const { nodes, edges } = buildZoneGraph([web, db], [flow('f1', { src_zone_id: '', src_cidr: '203.0.113.0/24', dst_zone_id: 'zd' })], [])
    const ext = nodes.find(n => n.id === 'external')!
    expect(ext).toBeTruthy()
    expect((ext.data as unknown as BoundaryNodeData).kind).toBe('external')
    expect(edges).toHaveLength(1)
    expect(edges[0].source).toBe('external')
    expect(edges[0].target).toBe('zone:zd')
  })

  it('adds an External node for a suggestion whose source is in no zone', () => {
    const { nodes, edges } = buildZoneGraph([web, db], [], [suggestion('s1', { src_zone_id: '' })])
    expect(nodes.find(n => n.id === 'external')).toBeTruthy()
    expect(edges[0]).toMatchObject({ source: 'external', target: 'zone:zd' })
    expect(edgeData(edges[0]).kind).toBe('pending')
  })

  it('has no External node when every end is a zone', () => {
    const { nodes } = buildZoneGraph([web, db], [flow('f1')], [suggestion('s1')])
    expect(nodes.find(n => n.id === 'external')).toBeUndefined()
    expect(nodes.find(n => n.id === 'outside')).toBeUndefined()
  })

  it('draws a CIDR destination as a dashed grey edge to an Outside node', () => {
    const { nodes, edges } = buildZoneGraph(
      [web, db],
      [flow('f1', { dst_zone_id: '', dst_cidr: '8.8.8.0/24', dport: '53', proto: 'udp' }), flow('f2', { dst_zone_id: '', dst_cidr: '1.1.1.1/32', dport: '53', proto: 'udp' })],
      [],
    )
    const out = nodes.find(n => n.id === 'outside')!
    expect((out.data as unknown as BoundaryNodeData).kind).toBe('outside')
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ source: 'zone:zw', target: 'outside' })
    expect(edgeData(edges[0])).toMatchObject({ kind: 'outside', particle: false, services: ['udp/53'] })
    expect(edges[0].style?.strokeDasharray).toBeTruthy()
    expect(edges[0].style?.stroke).toBe('#9e9e9e')
  })
})

describe('buildZoneGraph layout', () => {
  const zones = [web, db, app, zone('zx', 'cache'), zone('zy', 'queue')]
  const flows = [flow('f1'), flow('f2', { src_cidr: '10.0.0.0/8', src_zone_id: '' }), flow('f3', { dst_zone_id: '', dst_cidr: '8.8.8.8/32' })]
  const suggestions = [suggestion('s1')]

  it('is deterministic for the same input', () => {
    const a = buildZoneGraph(zones, flows, suggestions, new Map([['zw', 2]]))
    const b = buildZoneGraph(zones, flows, suggestions, new Map([['zw', 2]]))
    expect(b).toEqual(a)
  })

  it('does not depend on the order of the zones, the flows and the suggestions', () => {
    const a = buildZoneGraph(zones, flows, suggestions)
    const b = buildZoneGraph([...zones].reverse(), [...flows].reverse(), [...suggestions].reverse())
    const byId = <T extends { id: string }>(l: T[]) => [...l].sort((x, y) => x.id.localeCompare(y.id))
    expect(byId(b.nodes)).toEqual(byId(a.nodes))
    expect(byId(b.edges)).toEqual(byId(a.edges))
  })

  it('gives every node its own place, the External one on the left and the Outside one on the right', () => {
    const { nodes } = buildZoneGraph(zones, flows, suggestions)
    const spots = nodes.map(n => `${n.position.x},${n.position.y}`)
    expect(new Set(spots).size).toBe(nodes.length)
    expect(nodes.every(n => Number.isInteger(n.position.x) && Number.isInteger(n.position.y))).toBe(true)
    const zoneXs = nodes.filter(n => n.type === 'zone').map(n => n.position.x)
    expect(nodes.find(n => n.id === 'external')!.position.x).toBeLessThan(Math.min(...zoneXs))
    expect(nodes.find(n => n.id === 'outside')!.position.x).toBeGreaterThan(Math.max(...zoneXs))
  })

  it.each([1, 2, 3, 5, 8, 13, 24, 40])('never lays two of %i zones on top of each other', count => {
    const many = Array.from({ length: count }, (_, i) => zone(`z${i}`, `zone-${String(i).padStart(2, '0')}`))
    const { nodes } = buildZoneGraph(many, [], [])
    for (const [i, a] of nodes.entries()) {
      for (const b of nodes.slice(i + 1)) {
        const overlap = Math.abs(a.position.x - b.position.x) < NODE_W && Math.abs(a.position.y - b.position.y) < NODE_H
        expect(overlap, `${a.id} / ${b.id}`).toBe(false)
      }
    }
  })

  it('keeps to the right of the road: the two directions of a pair get the same offset, on opposite sides', () => {
    const { edges } = buildZoneGraph([web, db], [flow('f1'), flow('f2', { src_zone_id: 'zd', dst_zone_id: 'zw' })], [])
    const forward = edges.find(e => e.source === 'zone:zw')!
    const backward = edges.find(e => e.source === 'zone:zd')!
    // The offset is applied along the normal of each edge, and the normals of the two directions are opposite.
    expect(edgeData(forward).offset).toBe(edgeData(backward).offset)
    expect(edgeData(forward).offset).not.toBe(0)
  })

  it('leaves a lone edge in the middle', () => {
    const { edges } = buildZoneGraph([web, db], [flow('f1')], [])
    expect(edgeData(edges[0]).offset).toBe(0)
  })
})
