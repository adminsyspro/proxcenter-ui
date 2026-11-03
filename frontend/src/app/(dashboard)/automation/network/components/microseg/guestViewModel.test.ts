/**
 * The guest view is pure: one zone in the centre with its guests, on its left what talks to it, on its right what it
 * talks to, the observed flows guest to guest and the allowed ones circle to circle.
 */

import { describe, expect, it } from 'vitest'

import type { Edge, Node } from '@xyflow/react'

import { crossesBox, crossesCircle, rectAround, rectHitsCircle, rectsOverlap } from './edgeGeometry'
import { EMPTY_PEER_R, MAX_IPS, MAX_PER_COLUMN, buildGuestView, defaultCentre, ipNodeId, zoneTraffic } from './guestViewModel'
import { demoInput, seen, zone } from './mapViewsTestKit'
import { NODE_H, NODE_W, type MapEdgeData, type ZoneNodeData } from './zoneGraph'

const data = (e: Edge) => e.data as unknown as MapEdgeData
const demo = demoInput()
const view = (centre: string) => buildGuestView({ ...demo, centre })
const top = (nodes: Node[]) => nodes.filter(n => !n.parentId)
const cx = (nodes: Node[], id: string) => {
  const n = nodes.find(x => x.id === id)!
  return n.position.x + n.width! / 2
}

describe('the zone in the centre', () => {
  it('sums the pending hits of every zone, as a source and as a destination', () => {
    const traffic = zoneTraffic([...demo.zones, zone('zq', 'quiet')], demo.suggestions)
    expect(traffic.get('zd')).toBe(40 + 150 + 96)
    expect(traffic.get('zw')).toBe(40 + 7 + 150)
    expect(traffic.get('zm')).toBe(20 + 5)
    expect(traffic.get('zq')).toBe(0)
  })

  it('starts on the zone with the most observed traffic, by name when none has any', () => {
    expect(defaultCentre(demo.zones, demo.suggestions)).toBe('zd')
    expect(defaultCentre([zone('b', 'beta'), zone('a', 'alpha')], [])).toBe('a')
    expect(defaultCentre([], [])).toBeNull()
  })

  it('draws nothing for a zone that is not in the draft', () => {
    expect(view('gone')).toEqual({ nodes: [], edges: [] })
  })
})

describe('around the zone', () => {
  it('draws the centre zone with every guest, the peers with only the guests that talked to it', () => {
    const g = view('zd')
    expect(top(g.nodes).map(n => n.id).sort()).toEqual(['outside', 'zone:za', 'zone:zc', 'zone:zd', 'zone:zm', 'zone:zw'])
    expect(g.nodes.filter(n => n.parentId === 'zone:zd')).toHaveLength(4)
    expect(g.nodes.filter(n => n.parentId === 'zone:zw').map(n => n.id).sort()).toEqual(['guest:zw:qemu/100', 'guest:zw:qemu/101'])
    expect(g.nodes.filter(n => n.parentId === 'zone:zc').map(n => n.id)).toEqual(['guest:zc:qemu/501'])
    expect(g.nodes.filter(n => n.parentId === 'zone:za')).toHaveLength(0)
    expect((g.nodes.find(n => n.id === 'zone:zw')!.data as unknown as ZoneNodeData).members).toBe(8)
  })

  it('draws the observed flows guest to guest and the allowed ones circle to circle, nothing between two peers', () => {
    const ids = view('zd').edges.map(e => e.id).sort()
    expect(ids).toEqual([
      'allowed:zone:za>zone:zd',
      'allowed:zone:zm>zone:zd',
      'blocked:guest:zc:qemu/501>guest:zd:qemu/402',
      'blocked:guest:zw:qemu/101>guest:zd:qemu/401',
      'outside:zone:zd>outside',
      'unprotected:guest:zw:qemu/100>guest:zd:qemu/400',
    ])
  })

  it('puts what talks to the zone on its left and what it talks to on its right', () => {
    const g = view('zw')
    const centre = cx(g.nodes, 'zone:zw')
    for (const id of ['external', ipNodeId('203.0.113.9'), 'zone:za']) expect(cx(g.nodes, id), id).toBeLessThan(centre)
    expect(cx(g.nodes, 'zone:zd')).toBeGreaterThan(centre)
    expect(g.edges.map(e => e.id)).toContain(`blocked:${ipNodeId('203.0.113.9')}>guest:zw:qemu/102`)
    expect(g.nodes.find(n => n.id === ipNodeId('203.0.113.9'))).toMatchObject({ type: 'ip', width: NODE_W, height: NODE_H, data: { kind: 'ip', ip: '203.0.113.9' } })
  })

  it('draws a guest in no zone that talked to the zone in the circle of the unzoned guests, alone', () => {
    const g = view('za')
    expect(g.nodes.filter(n => n.parentId === 'unzoned').map(n => n.id)).toEqual(['guest:unzoned:qemu/900'])
    expect(g.edges.map(e => e.id)).toContain('unprotected:guest:unzoned:qemu/900>guest:za:qemu/301')
    expect(cx(g.nodes, 'unzoned')).toBeLessThan(cx(g.nodes, 'zone:za'))
  })

  it(`draws the ${MAX_IPS} busiest addresses on their own, the others from External`, () => {
    const many = Array.from({ length: MAX_IPS + 2 }, (_, i) => seen(`ip${i}`, { src_zone_id: '', src_ip: `198.51.100.${i + 1}`, dst_zone_id: 'zw', hits: 100 - i }))
    const g = buildGuestView({ ...demo, suggestions: many, centre: 'zw' })
    expect(g.nodes.filter(n => n.type === 'ip')).toHaveLength(MAX_IPS)
    expect(g.nodes.some(n => n.id === ipNodeId('198.51.100.10'))).toBe(false)
    expect(g.edges.filter(e => e.source === 'external' && data(e).kind === 'unprotected')).toHaveLength(1)
  })

  it('splits a tall side in columns, the nearest one next to the centre, and keeps a peer with no guest small', () => {
    const g = view('zd')
    const lefts = ['zone:za', 'zone:zc', 'zone:zm', 'zone:zw'].map(id => cx(g.nodes, id))
    expect(new Set(lefts).size).toBe(2)
    expect(lefts.filter(x => x === Math.max(...lefts))).toHaveLength(MAX_PER_COLUMN)
    expect(Math.max(...lefts)).toBeLessThan(cx(g.nodes, 'zone:zd'))
    expect(g.nodes.find(n => n.id === 'zone:za')!.width).toBe(2 * EMPTY_PEER_R)
  })

  it('draws the circles without guests while the guests are unknown', () => {
    const g = buildGuestView({ ...demo, members: null, unzoned: null, centre: 'zd' })
    expect(g.nodes.filter(n => n.parentId)).toHaveLength(0)
    expect(g.edges.map(e => e.id)).toContain('blocked:zone:zw>zone:zd')
  })

  it('is deterministic and does not depend on the order of the lists', () => {
    const b = buildGuestView({ ...demo, zones: [...demo.zones].reverse(), flows: [...demo.flows].reverse(), suggestions: [...demo.suggestions].reverse(), centre: 'zd' })
    expect(b).toEqual(view('zd'))
  })
})

describe('every demo zone in the centre is readable', () => {
  for (const [id] of [['zw'], ['zad'], ['za'], ['zd'], ['zc'], ['zm']]) {
    it(`${id}: no node on another, no edge through a foreign node, no label on a label or a node`, () => {
      const g = view(id)
      const abs = new Map<string, { x: number; y: number }>()
      for (const n of g.nodes) {
        const p = n.parentId ? abs.get(n.parentId)! : { x: 0, y: 0 }
        abs.set(n.id, { x: p.x + n.position.x, y: p.y + n.position.y })
      }
      const tops = top(g.nodes).map(n => ({ id: n.id, box: n.type === 'boundary' || n.type === 'ip', c: { x: abs.get(n.id)!.x + n.width! / 2, y: abs.get(n.id)!.y + n.height! / 2 }, r: n.width! / 2 }))
      const groupOf = (nid: string) => g.nodes.find(n => n.id === nid)!.parentId ?? nid
      const problems: string[] = []
      for (const [i, a] of tops.entries()) {
        for (const b of tops.slice(i + 1)) {
          const ra = rectAround(a.c, a.box ? NODE_W : 2 * a.r, a.box ? NODE_H : 2 * a.r)
          const rb = rectAround(b.c, b.box ? NODE_W : 2 * b.r, b.box ? NODE_H : 2 * b.r)
          if (rectsOverlap(ra, rb, 20)) problems.push(`${a.id} on ${b.id}`)
        }
      }
      for (const e of g.edges) {
        const own = new Set([groupOf(e.source), groupOf(e.target)])
        for (const t of tops) {
          if (own.has(t.id)) continue
          const hit = t.box ? crossesBox(data(e).points, t.c, NODE_W / 2, NODE_H / 2, 0) : crossesCircle(data(e).points, t.c, t.r, 0)
          if (hit) problems.push(`${e.id} through ${t.id}`)
        }
      }
      const labels = g.edges.map(e => [e.id, rectAround({ x: data(e).label_x, y: data(e).label_y }, data(e).label_w, data(e).label_h)] as const)
      for (const [i, [lid, r]] of labels.entries()) {
        for (const [other, s] of labels.slice(i + 1)) if (rectsOverlap(r, s)) problems.push(`${lid} / ${other}`)
        for (const t of tops) {
          const hit = t.box ? rectsOverlap(r, rectAround(t.c, NODE_W, NODE_H)) : rectHitsCircle(r, t.c, t.r)
          if (hit) problems.push(`${lid} on ${t.id}`)
        }
      }
      expect(problems).toEqual([])
    })
  }
})
