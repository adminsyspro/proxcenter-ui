/**
 * buildCompactGraph is pure: a box per zone (no guest), the layered columns of the groups view, one edge per ordered
 * pair and kind, the observed flows zone to zone.
 */

import { describe, expect, it } from 'vitest'

import type { Edge } from '@xyflow/react'

import { BOX_H, BOX_W, buildCompactGraph } from './compactGraph'
import { crossesBox, rectAround, rectsOverlap, type Rect } from './edgeGeometry'
import { demoInput, flow, seen, zone } from './mapViewsTestKit'
import { NODE_H, NODE_W, type MapEdgeData, type ZoneNodeData } from './zoneGraph'

const data = (e: Edge) => e.data as unknown as MapEdgeData
const web = zone('zw', 'web')
const db = zone('zd', 'db')

describe('compact zones', () => {
  it('draws a box per zone with its member count, and no guest', () => {
    const { members, unzoned } = demoInput()
    const g = buildCompactGraph({ zones: [web, db], flows: [], suggestions: [], members, unzoned })
    expect(g.nodes.map(n => n.id).sort()).toEqual(['zone:zd', 'zone:zw'])
    expect(g.nodes.every(n => n.type === 'zoneBox' && !n.parentId && n.width === BOX_W && n.height === BOX_H)).toBe(true)
    expect((g.nodes.find(n => n.id === 'zone:zw')!.data as unknown as ZoneNodeData).members).toBe(8)
    expect(g.edges).toEqual([])
  })

  it('leaves the member count unknown while the guests are unknown', () => {
    const g = buildCompactGraph({ zones: [web], flows: [], suggestions: [], members: null })
    expect((g.nodes[0].data as unknown as ZoneNodeData).members).toBeNull()
  })

  it('draws one green edge per ordered pair, its label grouping the ports', () => {
    const g = buildCompactGraph({ zones: [web, db], flows: [flow('f1'), flow('f2', { dport: '22' }), flow('f3', { src_zone_id: 'zd', dst_zone_id: 'zw' })], suggestions: [] })
    expect(g.edges.map(e => e.id).sort()).toEqual(['allowed:zone:zd>zone:zw', 'allowed:zone:zw>zone:zd'])
    expect(data(g.edges.find(e => e.id === 'allowed:zone:zw>zone:zd')!).label).toBe('tcp/22, 443')
    expect(data(g.edges[0]).count).toBeGreaterThan(0)
  })

  it('draws the observed flows zone to zone, apart from the allowed edge, an unknown source from External', () => {
    const g = buildCompactGraph({
      zones: [web, db],
      flows: [flow('f1')],
      suggestions: [seen('s1'), seen('s2', { dport: '22' }), seen('s3', { kind: 'blocked' }), seen('s4', { src_zone_id: '', src_ip: '10.9.0.1' }), seen('s5', { status: 'dismissed' })],
    })
    const ids = g.edges.map(e => e.id).sort()
    expect(ids).toEqual(['allowed:zone:zw>zone:zd', 'blocked:zone:zw>zone:zd', 'unprotected:external>zone:zd', 'unprotected:zone:zw>zone:zd'])
    const unprotected = data(g.edges.find(e => e.id === 'unprotected:zone:zw>zone:zd')!)
    expect(unprotected.count).toBe(2)
    expect(unprotected.label).toBe('tcp/22, 80')
    expect(g.nodes.some(n => n.id === 'external')).toBe(true)
  })

  it('ignores an observed flow whose destination is no zone, and a flow inside one zone', () => {
    const g = buildCompactGraph({ zones: [web, db], flows: [flow('f1', { dst_zone_id: 'zw' })], suggestions: [seen('s1', { dst_zone_id: 'gone' })] })
    expect(g.edges).toEqual([])
  })

  it('is deterministic and does not depend on the order of the lists', () => {
    const input = demoInput()
    const a = buildCompactGraph(input)
    const b = buildCompactGraph({ ...input, zones: [...input.zones].reverse(), flows: [...input.flows].reverse(), suggestions: [...input.suggestions].reverse() })
    expect(b).toEqual(a)
  })
})

describe('the demo-like compact map is readable', () => {
  const graph = buildCompactGraph(demoInput())
  const centre = (id: string) => {
    const n = graph.nodes.find(x => x.id === id)!
    return { x: n.position.x + n.width! / 2, y: n.position.y + n.height! / 2, w: n.width!, h: n.height! }
  }
  const boxes = graph.nodes.map(n => ({ id: n.id, ...centre(n.id) }))

  it('reads External -> web/admin/monitoring -> app -> db/cache -> Outside', () => {
    const cx = (id: string) => centre(id).x
    expect(cx('external')).toBeLessThan(cx('zone:zw'))
    expect(cx('zone:zw')).toBe(cx('zone:zad'))
    expect(cx('zone:zw')).toBe(cx('zone:zm'))
    expect(cx('zone:zw')).toBeLessThan(cx('zone:za'))
    expect(cx('zone:za')).toBeLessThan(cx('zone:zd'))
    expect(cx('zone:zd')).toBe(cx('zone:zc'))
    expect(cx('zone:zd')).toBeLessThan(cx('outside'))
    expect(centre('external').w).toBe(NODE_W)
    expect(centre('outside').h).toBe(NODE_H)
  })

  it('has the edges it should', () => {
    expect(graph.edges.filter(e => ['allowed', 'outside'].includes(data(e).kind))).toHaveLength(11)
    expect(graph.edges.filter(e => data(e).kind === 'unprotected').map(e => e.id).sort()).toEqual(['unprotected:external>zone:za', 'unprotected:zone:zad>zone:zc', 'unprotected:zone:zw>zone:zd'])
    expect(graph.edges.filter(e => data(e).kind === 'blocked').map(e => e.id).sort()).toEqual(['blocked:external>zone:zw', 'blocked:zone:zc>zone:zd', 'blocked:zone:zw>zone:zd'])
  })

  it('lays no box on another', () => {
    for (const [i, a] of boxes.entries()) {
      for (const b of boxes.slice(i + 1)) expect(rectsOverlap(rectAround(a, a.w, a.h), rectAround(b, b.w, b.h), 20), `${a.id} ${b.id}`).toBe(false)
    }
  })

  it('draws no edge through a box it does not belong to', () => {
    const crossings: string[] = []
    for (const e of graph.edges) {
      for (const b of boxes) {
        if (b.id !== e.source && b.id !== e.target && crossesBox(data(e).points, b, b.w / 2, b.h / 2, 0)) crossings.push(`${e.id} through ${b.id}`)
      }
    }
    expect(crossings).toEqual([])
  })

  it('lays no label on another label or on a box', () => {
    const rects: Array<[string, Rect]> = graph.edges.map(e => [e.id, rectAround({ x: data(e).label_x, y: data(e).label_y }, data(e).label_w, data(e).label_h)])
    const problems: string[] = []
    for (const [i, [id, r]] of rects.entries()) {
      for (const [other, s] of rects.slice(i + 1)) if (rectsOverlap(r, s)) problems.push(`${id} / ${other}`)
      for (const b of boxes) if (rectsOverlap(r, rectAround(b, b.w, b.h))) problems.push(`${id} on ${b.id}`)
    }
    expect(problems).toEqual([])
  })
})
