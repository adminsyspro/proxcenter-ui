/**
 * The node view is pure: a circle per Proxmox node holding its guests in the colour of their zone, the observed flows
 * and the exceptions aggregated from node to node, nothing for what stays inside a node.
 */

import { describe, expect, it } from 'vitest'

import type { Edge, Node } from '@xyflow/react'

import { exception, flow, member, seen, zone } from './mapViewsTestKit'
import { UNZONED_COLOR, applyInsideFilters, buildNodeView } from './nodeViewModel'
import { ALL_FLOWS, pveNodeId, type GuestNodeData, type MapEdgeData, type MapInput, type MoreNodeData, type PveNodeData } from './zoneGraph'

const data = (e: Edge) => e.data as unknown as MapEdgeData
const top = (nodes: Node[]) => nodes.filter(n => !n.parentId)
const pve = (nodes: Node[], name: string) => nodes.find(n => n.id === pveNodeId(name))!.data as unknown as PveNodeData
const guest = (nodes: Node[], id: string) => nodes.find(n => n.id === id)!.data as unknown as GuestNodeData

const WEB = '#ff5722'
const DB = '#3f51b5'

/** web-1 and lost-1 on pve1, web-2 and db-1 on pve2, db-2 on pve3. */
function input(over: Partial<MapInput> = {}): MapInput {
  return {
    zones: [zone('zw', 'web', { color: WEB }), zone('zd', 'db', { color: DB })],
    flows: [flow('f1')],
    suggestions: [],
    members: new Map([
      ['zw', [member(100, 'web-1', ['10.0.1.1'], { node: 'pve1' }), member(101, 'web-2', ['10.0.1.2/24'], { node: 'pve2' })]],
      ['zd', [member(200, 'db-1', ['10.0.4.1'], { node: 'pve2' }), member(201, 'db-2', ['10.0.4.2'], { node: 'pve3', type: 'lxc', key: 'lxc/201' })]],
    ]),
    unzoned: [member(900, 'lost-1', ['10.9.0.1'], { node: 'pve1' })],
    ...over,
  }
}

describe('the circles of the node view', () => {
  it('draws one circle per Proxmox node, by name, with its guest count and the zones it holds', () => {
    const g = buildNodeView(input())
    expect(top(g.nodes).map(n => n.id)).toEqual(['pve:pve1', 'pve:pve2', 'pve:pve3'])
    expect(top(g.nodes).every(n => n.type === 'pveNode')).toBe(true)
    expect(pve(g.nodes, 'pve1')).toMatchObject({ kind: 'pveNode', node: 'pve1', count: 2, unzoned: 1, inside: 0, zones: [{ id: 'zw', name: 'web', color: WEB, count: 1 }] })
    expect(pve(g.nodes, 'pve2').zones).toEqual([{ id: 'zd', name: 'db', color: DB, count: 1 }, { id: 'zw', name: 'web', color: WEB, count: 1 }])
    expect(pve(g.nodes, 'pve2').unzoned).toBe(0)
  })

  it('places every guest in the circle of its node, in the colour of its zone, grey without a zone', () => {
    const g = buildNodeView(input())
    expect(g.nodes.filter(n => n.parentId === 'pve:pve1').map(n => n.id)).toEqual(['guest:pve:pve1:qemu/900', 'guest:pve:pve1:qemu/100'])
    expect(guest(g.nodes, 'guest:pve:pve1:qemu/100')).toMatchObject({ kind: 'guest', color: WEB, zone: 'web', member: { name: 'web-1', type: 'qemu', status: 'running' } })
    expect(guest(g.nodes, 'guest:pve:pve3:lxc/201')).toMatchObject({ color: DB, zone: 'db', member: { type: 'lxc' } })
    expect(guest(g.nodes, 'guest:pve:pve1:qemu/900')).toMatchObject({ color: UNZONED_COLOR, zone: null })
  })

  it('draws a guest two zones hold once, in the first zone by name', () => {
    const base = input()
    const members = new Map(base.members!)
    members.set('zd', [...members.get('zd')!, member(100, 'web-1', ['10.0.1.1'], { node: 'pve1', pending: true })])
    const g = buildNodeView({ ...base, members })
    expect(g.nodes.filter(n => n.id.endsWith('qemu/100'))).toHaveLength(1)
    expect(guest(g.nodes, 'guest:pve:pve1:qemu/100').color).toBe(DB)
    expect(pve(g.nodes, 'pve1').count).toBe(2)
  })

  it('stands for the guests past the threshold of a circle with a "+N" node', () => {
    const many = Array.from({ length: 14 }, (_, i) => member(300 + i, `app-${String(i + 1).padStart(2, '0')}`, [], { node: 'pve9' }))
    const g = buildNodeView(input({ members: new Map([['zw', many]]), unzoned: [] }))
    const inside = g.nodes.filter(n => n.parentId === 'pve:pve9')
    expect(inside.filter(n => n.type === 'guest')).toHaveLength(11)
    expect(inside.find(n => n.type === 'more')!.data as unknown as MoreNodeData).toEqual({ kind: 'more', count: 3, groupId: 'pve:pve9' })
    expect(pve(g.nodes, 'pve9').count).toBe(14)
  })

  it('draws a circle for every node of the connection, an empty one too, and counts every guest of a node', () => {
    const pveNodes = [{ node: 'pve1', guests: 5, status: 'online' }, { node: 'pve0', guests: 0 }, { node: 'pve2', guests: 2 }, { node: 'pve3', guests: 1 }, { node: 'pve4', guests: 3 }]
    const g = buildNodeView(input({ pveNodes }))
    expect(top(g.nodes).map(n => n.id)).toEqual(['pve:pve0', 'pve:pve1', 'pve:pve2', 'pve:pve3', 'pve:pve4'])
    expect(pve(g.nodes, 'pve0')).toMatchObject({ count: 0, zones: [], unzoned: 0, inside: 0 })
    expect(g.nodes.filter(n => n.parentId === 'pve:pve0')).toHaveLength(0)
    // Five guests on pve1 for Proxmox (three stopped in no zone), two of them drawn.
    expect(pve(g.nodes, 'pve1').count).toBe(5)
    expect(pve(g.nodes, 'pve1').status).toBe('online')
    expect(pve(g.nodes, 'pve0').status).toBeUndefined()
    expect(g.nodes.filter(n => n.parentId === 'pve:pve1')).toHaveLength(2)
    expect(pve(g.nodes, 'pve4')).toMatchObject({ count: 3, zones: [], unzoned: 0 })
  })

  it('marks a guest that is not running: it cannot be targeted', () => {
    const base = input()
    const g = buildNodeView({ ...base, members: new Map([['zw', [member(100, 'web-1', [], { node: 'pve1' }), member(101, 'web-2', [], { node: 'pve1', status: 'stopped' })]]]) })
    expect(guest(g.nodes, 'guest:pve:pve1:qemu/100').inert).toBe(false)
    expect(guest(g.nodes, 'guest:pve:pve1:qemu/101').inert).toBe(true)
  })

  it('draws nothing while the guests are unknown', () => {
    expect(buildNodeView(input({ members: null, unzoned: null }))).toEqual({ nodes: [], edges: [] })
  })
})

describe('the flows of the node view', () => {
  const observed = [
    seen('s1', { src_zone_id: 'zw', src_ip: '10.0.1.1', dst_zone_id: 'zd', dst_ip: '10.0.4.1', dport: '5432', hits: 40 }),
    seen('s2', { src_zone_id: '', src_ip: '10.9.0.1', dst_zone_id: 'zd', dst_ip: '10.0.4.1', dport: '22', hits: 2 }),
    seen('s3', { kind: 'blocked', src_zone_id: 'zw', src_ip: '10.0.1.1', dst_zone_id: 'zd', dst_ip: '10.0.4.1', dport: '3389', hits: 7 }),
    // Inside pve2: no edge, the circle counts it.
    seen('s4', { src_zone_id: 'zw', src_ip: '10.0.1.2', dst_zone_id: 'zd', dst_ip: '10.0.4.1', dport: '5432', hits: 9 }),
    // An address that is no guest, a resolved flow, a zone that is gone: nothing.
    seen('s5', { src_zone_id: '', src_ip: '203.0.113.9', dst_zone_id: 'zd', dst_ip: '10.0.4.2', hits: 5 }),
    seen('s6', { status: 'accepted', src_zone_id: 'zw', src_ip: '10.0.1.1', dst_zone_id: 'zd', dst_ip: '10.0.4.2' }),
    seen('s7', { src_zone_id: 'zw', src_ip: '10.0.1.1', dst_zone_id: 'gone', dst_ip: '10.0.4.2' }),
  ]

  it('aggregates the observed flows between two nodes, per kind, with their services, hits and guest pairs', () => {
    const g = buildNodeView(input({ suggestions: observed }))
    expect(g.edges.map(e => e.id)).toEqual(['unprotected:pve:pve1>pve:pve2', 'blocked:pve:pve1>pve:pve2'])
    const open = data(g.edges[0])
    expect(open).toMatchObject({ kind: 'unprotected', services: ['tcp/22', 'tcp/5432'], label: 'SSH, PostgreSQL', count: 2, hits: 42, fromGroup: 'pve:pve1', toGroup: 'pve:pve2' })
    expect(open.observed.map(s => s.id)).toEqual(['s1', 's2'])
    expect(open.guestPairs).toEqual([
      { key: 'qemu/900>qemu/200', from: 'lost-1', to: 'db-1', services: ['tcp/22'] },
      { key: 'qemu/100>qemu/200', from: 'web-1', to: 'db-1', services: ['tcp/5432'] },
    ])
    expect(data(g.edges[1])).toMatchObject({ kind: 'blocked', services: ['tcp/3389'], count: 1, hits: 7, guestPairs: [{ key: 'qemu/100>qemu/200', from: 'web-1', to: 'db-1', services: ['tcp/3389'] }] })
  })

  it('draws no edge for a flow between two guests of one node: the circle counts it', () => {
    const g = buildNodeView(input({ suggestions: observed }))
    expect(g.edges.some(e => e.source === e.target)).toBe(false)
    expect(pve(g.nodes, 'pve2')).toMatchObject({ inside: 1, insideByKind: { unprotected: 1, blocked: 0 } })
    expect(pve(g.nodes, 'pve1').inside).toBe(0)
  })

  it('counts the flows inside a node per kind, and only the kinds the flow checkboxes show', () => {
    const more = [...observed, seen('s8', { kind: 'blocked', src_zone_id: 'zw', src_ip: '10.0.1.2', dst_zone_id: 'zd', dst_ip: '10.0.4.1', dport: '22' })]
    const g = buildNodeView(input({ suggestions: more }))
    expect(pve(g.nodes, 'pve2')).toMatchObject({ inside: 2, insideByKind: { unprotected: 1, blocked: 1 } })
    expect(pve(applyInsideFilters(g, ALL_FLOWS).nodes, 'pve2').inside).toBe(2)
    expect(pve(applyInsideFilters(g, { ...ALL_FLOWS, unprotected: false }).nodes, 'pve2').inside).toBe(1)
    expect(pve(applyInsideFilters(g, { allowed: true, unprotected: false, blocked: false }).nodes, 'pve2').inside).toBe(0)
    expect(applyInsideFilters(g, ALL_FLOWS).edges).toBe(g.edges)
  })

  it('finds the guest of an address in the whole connection: a source seen in no zone and since put in one is still drawn', () => {
    const g = buildNodeView(input({ suggestions: [seen('s1', { src_zone_id: '', src_ip: '10.0.1.1', dst_zone_id: 'zd', dst_ip: '10.0.4.1', dport: '5432' })] }))
    expect(g.edges.map(e => e.id)).toEqual(['unprotected:pve:pve1>pve:pve2'])
    expect(data(g.edges[0]).guestPairs).toEqual([{ key: 'qemu/100>qemu/200', from: 'web-1', to: 'db-1', services: ['tcp/5432'] }])
  })

  it('draws an exception from the node of its source to the node of its destination, as an exception', () => {
    const e1 = exception('e1', { sources: [{ type: 'qemu', vmid: 100, name: 'web-1' }, { type: 'qemu', vmid: 101, name: 'web-2' }], destinations: [{ type: 'lxc', vmid: 201, name: 'db-2' }, { type: 'qemu', vmid: 200, name: 'db-1' }] })
    const g = buildNodeView(input({ exceptions: [e1] }))
    // web-2 to db-1 stays inside pve2.
    expect(g.edges.map(e => e.id)).toEqual(['exception:pve:pve1>pve:pve2', 'exception:pve:pve1>pve:pve3', 'exception:pve:pve2>pve:pve3'])
    expect(data(g.edges[1])).toMatchObject({ kind: 'exception', services: ['tcp/5432'], label: 'PostgreSQL', exceptions: [e1], exceptionCount: 0, guestPairs: [{ key: 'qemu/100>lxc/201', from: 'web-1', to: 'db-2', services: ['tcp/5432'] }] })
  })

  it('draws no exception of a zone that is neither observed nor enforced, and no allowed flow between zones', () => {
    const zones = [zone('zw', 'web'), zone('zd', 'db', { state: 'disabled' })]
    const g = buildNodeView(input({ zones, exceptions: [exception('e1', { sources: [{ type: 'qemu', vmid: 100, name: 'web-1' }], destinations: [{ type: 'lxc', vmid: 201, name: 'db-2' }] })] }))
    expect(g.edges).toEqual([])
  })

  it('lays the circles out without overlap and every edge between two of them', () => {
    const g = buildNodeView(input({ suggestions: observed }))
    const circles = top(g.nodes).map(n => ({ x: n.position.x + n.width! / 2, y: n.position.y + n.height! / 2, r: n.width! / 2 }))
    for (let i = 0; i < circles.length; i++) {
      for (let j = i + 1; j < circles.length; j++) {
        expect(Math.hypot(circles[i].x - circles[j].x, circles[i].y - circles[j].y)).toBeGreaterThan(circles[i].r + circles[j].r)
      }
    }
    for (const e of g.edges) expect(data(e).path).toMatch(/^M/)
  })
})
