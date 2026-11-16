/**
 * The guest view is pure: one zone in the centre with its guests, on its left what talks to it, on its right what it
 * talks to, the observed flows guest to guest and the allowed ones circle to circle.
 */

import { describe, expect, it } from 'vitest'

import type { Edge, Node } from '@xyflow/react'

import { crossesBox, crossesCircle, rectAround, rectHitsCircle, rectsOverlap } from './edgeGeometry'
import { EMPTY_PEER_R, MAX_BOXES_PER_COLUMN, MAX_IPS, MAX_PER_COLUMN, buildGuestView, buildZoneInside, defaultCentre, ipNodeId, zoneTraffic } from './guestViewModel'
import { BOX_W } from './compactGraph'
import { demoInput, exception, member, seen, zone } from './mapViewsTestKit'
import { EDGE_COLORS, NODE_H, NODE_W, type GuestNodeData, type MapEdgeData, type ZoneNodeData } from './zoneGraph'
import { INSIDE_GUEST_W, INSIDE_MAX_SHOWN } from './zoneLayout'

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

  it('names an address that is the gateway of a zone, and draws it before busier addresses', () => {
    const many = Array.from({ length: MAX_IPS + 2 }, (_, i) => seen(`ip${i}`, { src_zone_id: '', src_ip: `198.51.100.${i + 1}`, dst_zone_id: 'zw', hits: 100 - i }))
    const zones = demo.zones.map(z => (z.id === 'zw' ? { ...z, gateway: '198.51.100.10' } : z))
    const g = buildGuestView({ ...demo, zones, suggestions: many, centre: 'zw' })
    expect(g.nodes.find(n => n.id === ipNodeId('198.51.100.10'))?.data).toEqual({ kind: 'ip', ip: '198.51.100.10', gatewayOf: [zones.find(z => z.id === 'zw')!.name] })
    expect(g.nodes.find(n => n.id === ipNodeId('198.51.100.1'))?.data).toEqual({ kind: 'ip', ip: '198.51.100.1' })
  })

  it('draws the allowed flows from and to a gateway on the gateway, not on External and Outside', () => {
    const zones = demo.zones.map(z => (z.id === 'zw' ? { ...z, gateway: '10.9.0.1' } : z))
    const base = { ...demo.flows[0], src_zone_id: '', src_cidr: '', dst_zone_id: '', dst_cidr: '', dport: '' }
    const flows = [
      { ...base, id: 'gin', src_cidr: '10.9.0.1/32', dst_zone_id: 'zw', proto: 'tcp', dport: '22' },
      { ...base, id: 'gout', src_zone_id: 'zw', dst_cidr: '10.9.0.1/32', proto: 'udp', dport: '53' },
    ]
    const g = buildGuestView({ ...demo, zones, flows, suggestions: [], centre: 'zw' })
    const gw = ipNodeId('10.9.0.1')
    expect(g.nodes.find(n => n.id === gw)?.data).toMatchObject({ gatewayOf: [zones.find(z => z.id === 'zw')!.name] })
    expect(g.edges.map(e => [e.source, e.target])).toEqual(expect.arrayContaining([[gw, 'zone:zw'], ['zone:zw', gw]]))
    expect(g.nodes.some(n => n.id === 'external' || n.id === 'outside')).toBe(false)
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

describe('the exceptions of the view', () => {
  const withExceptions = (centre: string, ...exceptions: ReturnType<typeof exception>[]) => buildGuestView({ ...demo, exceptions, centre })
  const exceptionIds = (g: { edges: Edge[] }) => g.edges.filter(e => data(e).kind === 'exception').map(e => e.id).sort()
  const guest = (vmid: number, name = '') => ({ type: 'qemu' as const, vmid, name })

  it('draws an exception as a dashed green edge from its source guest to its destination guest, labelled with its services', () => {
    const g = withExceptions('zd', exception('x1', { services: [{ proto: 'tcp', dport: '5432' }, { proto: 'tcp', dport: '22' }] }))
    expect(exceptionIds(g)).toEqual(['exception:guest:zw:qemu/105>guest:zd:qemu/402'])
    const edge = g.edges.find(e => data(e).kind === 'exception')!
    expect(data(edge)).toMatchObject({ label: 'SSH, PostgreSQL', services: ['tcp/22', 'tcp/5432'], color: EDGE_COLORS.allowed, particle: false, small: true, exceptionCount: 0, fromGroup: 'zone:zw', toGroup: 'zone:zd' })
    expect(edge.style?.strokeDasharray).toBe('6 4')
    // The panel of the edge lists the exceptions it stands for.
    expect(data(edge).exceptions.map(e => e.id)).toEqual(['x1'])
    // The source did not talk to the centre: the exception alone draws it in its zone.
    expect(g.nodes.filter(n => n.parentId === 'zone:zw').map(n => n.id).sort()).toEqual(['guest:zw:qemu/100', 'guest:zw:qemu/101', 'guest:zw:qemu/105'])
  })

  it('draws one edge per source and destination, and merges the services of two exceptions of a pair', () => {
    const g = withExceptions(
      'zd',
      exception('x1', { sources: [guest(105), guest(106)], destinations: [guest(402), guest(403)] }),
      exception('x2', { services: [{ proto: 'tcp', dport: '22' }] }),
    )
    expect(exceptionIds(g)).toEqual([
      'exception:guest:zw:qemu/105>guest:zd:qemu/402', 'exception:guest:zw:qemu/105>guest:zd:qemu/403',
      'exception:guest:zw:qemu/106>guest:zd:qemu/402', 'exception:guest:zw:qemu/106>guest:zd:qemu/403',
    ])
    expect(data(g.edges.find(e => e.id === 'exception:guest:zw:qemu/105>guest:zd:qemu/402')!).label).toBe('SSH, PostgreSQL')
    expect(data(g.edges.find(e => e.id === 'exception:guest:zw:qemu/106>guest:zd:qemu/403')!).label).toBe('PostgreSQL')
    expect(data(g.edges.find(e => e.id === 'exception:guest:zw:qemu/105>guest:zd:qemu/402')!).exceptions.map(e => e.id)).toEqual(['x1', 'x2'])
    expect(data(g.edges.find(e => e.id === 'exception:guest:zw:qemu/106>guest:zd:qemu/403')!).exceptions.map(e => e.id)).toEqual(['x1'])
  })

  it('draws the zone of a source on the left of the centre even when nothing else links them', () => {
    const g = withExceptions('zd', exception('x1', { sources: [guest(203)] }))
    expect(exceptionIds(g)).toEqual(['exception:guest:zad:qemu/203>guest:zd:qemu/402'])
    expect(g.nodes.filter(n => n.parentId === 'zone:zad').map(n => n.id)).toEqual(['guest:zad:qemu/203'])
    expect(cx(g.nodes, 'zone:zad')).toBeLessThan(cx(g.nodes, 'zone:zd'))
  })

  it('draws an exception between two members of the centre inside its circle', () => {
    expect(exceptionIds(withExceptions('zd', exception('x1', { sources: [guest(400)] })))).toEqual(['exception:guest:zd:qemu/400>guest:zd:qemu/402'])
  })

  it('draws a source in no zone in the circle of the guests in no zone', () => {
    const g = withExceptions('zd', exception('x1', { sources: [guest(901)] }))
    expect(exceptionIds(g)).toEqual(['exception:guest:unzoned:qemu/901>guest:zd:qemu/402'])
    expect(g.nodes.filter(n => n.parentId === 'unzoned').map(n => n.id)).toEqual(['guest:unzoned:qemu/901'])
  })

  it('draws the exception of a peer zone a member of the centre is a source of', () => {
    const g = withExceptions('zw', exception('x1'))
    expect(exceptionIds(g)).toEqual(['exception:guest:zw:qemu/105>guest:zd:qemu/402'])
    expect(g.nodes.some(n => n.id === 'guest:zd:qemu/402')).toBe(true)
    // Nothing between two peers: the same exception is not drawn around a third zone.
    expect(exceptionIds(withExceptions('za', exception('x1')))).toEqual([])
  })

  it('ends on the "+N" node for a member of the centre that is not drawn', () => {
    const many = new Map(demo.members)
    many.set('zd', Array.from({ length: 14 }, (_, i) => ({ ...demo.members.get('zd')![0], key: `qemu/${400 + i}`, vmid: 400 + i, name: `db-${String(i + 1).padStart(2, '0')}`, ips: [] })))
    const g = buildGuestView({ ...demo, members: many, exceptions: [exception('x1', { destinations: [guest(413)] })], centre: 'zd' })
    expect(exceptionIds(g)).toEqual(['exception:guest:zw:qemu/105>more:zd'])
  })

  it('draws nothing for a zone that is off, a destination that is no member, a guest the map does not know, or while the guests are unknown', () => {
    const off = buildGuestView({ ...demo, zones: demo.zones.map(z => (z.id === 'zd' ? { ...z, state: 'disabled' as const } : z)), exceptions: [exception('x1')], centre: 'zd' })
    expect(exceptionIds(off)).toEqual([])
    expect(exceptionIds(withExceptions('zd', exception('x1', { destinations: [guest(300)] })))).toEqual([])
    expect(exceptionIds(withExceptions('zd', exception('x1', { sources: [guest(9999)] })))).toEqual([])
    expect(exceptionIds(withExceptions('zd', exception('x1', { zone_id: 'gone' })))).toEqual([])
    expect(exceptionIds(buildGuestView({ ...demo, members: null, exceptions: [exception('x1')], centre: 'zd' }))).toEqual([])
    // Without exceptions the view is what it was.
    expect(buildGuestView({ ...demo, exceptions: [], centre: 'zd' })).toEqual(view('zd'))
  })
})

describe('inside a zone', () => {
  const inside = (centre: string, over: Partial<ReturnType<typeof demoInput>> = {}) => buildZoneInside({ ...demo, ...over, centre })

  it('draws the zone alone as a circle with every guest, wide enough for its name, and a box per zone around it', () => {
    const g = inside('zd')
    expect(top(g.nodes).map(n => `${n.type}:${n.id}`).sort()).toEqual(['boundary:outside', 'zone:zone:zd', 'zoneBox:zone:za', 'zoneBox:zone:zc', 'zoneBox:zone:zm', 'zoneBox:zone:zw'])
    const guests = g.nodes.filter(n => n.parentId === 'zone:zd')
    expect(guests.map(n => n.id).sort()).toEqual(['guest:zd:qemu/400', 'guest:zd:qemu/401', 'guest:zd:qemu/402', 'guest:zd:qemu/403'])
    for (const n of guests) {
      expect(n.width).toBe(INSIDE_GUEST_W)
      expect((n.data as unknown as GuestNodeData).width).toBe(INSIDE_GUEST_W)
    }
    // No guest of another zone is drawn: the other zones are folded into their boxes, with their member count.
    expect(g.nodes.filter(n => n.parentId && n.parentId !== 'zone:zd')).toHaveLength(0)
    expect((g.nodes.find(n => n.id === 'zone:zw')!.data as unknown as ZoneNodeData).members).toBe(8)
    expect(g.nodes.find(n => n.id === 'zone:zw')!.width).toBe(BOX_W)
    const centre = g.nodes.find(n => n.id === 'zone:zd')!.data as unknown as ZoneNodeData
    expect(centre.entered).toBe(true)
    expect(centre.members).toBe(4)
  })

  it('keeps every guest inside the circle and the zone larger than on the guest view', () => {
    const g = inside('zw')
    const circle = g.nodes.find(n => n.id === 'zone:zw')!
    const r = circle.width! / 2
    expect(r).toBeGreaterThan(view('zw').nodes.find(n => n.id === 'zone:zw')!.width! / 2)
    for (const n of g.nodes.filter(x => x.parentId === 'zone:zw')) {
      expect(Math.hypot(n.position.x + n.width! / 2 - r, n.position.y + n.height! / 2 - r)).toBeLessThan(r)
    }
  })

  it('draws what its guests exchange with each other guest to guest, and every flow with another zone from its guest to the box', () => {
    const g = inside('zd', { suggestions: [...demo.suggestions, seen('in1', { src_zone_id: 'zd', src_ip: '10.0.4.1', dst_zone_id: 'zd', dst_ip: '10.0.4.4', dport: '5432', hits: 9 })] })
    expect(g.edges.map(e => e.id).sort()).toEqual([
      'allowed:zone:za>zone:zd',
      'allowed:zone:zm>zone:zd',
      'blocked:zone:zc>guest:zd:qemu/402',
      'blocked:zone:zw>guest:zd:qemu/401',
      'outside:zone:zd>outside',
      'unprotected:guest:zd:qemu/400>guest:zd:qemu/403',
      'unprotected:zone:zw>guest:zd:qemu/400',
    ])
    const own = g.edges.find(e => e.id === 'unprotected:guest:zd:qemu/400>guest:zd:qemu/403')!
    expect(data(own)).toMatchObject({ fromGroup: 'zone:zd', toGroup: 'zone:zd', hits: 9, small: true })
    expect(data(g.edges.find(e => e.id === 'blocked:zone:zw>guest:zd:qemu/401')!)).toMatchObject({ fromGroup: 'zone:zw', toGroup: 'zone:zd', hits: 150 })
  })

  it('puts the zones that talk to it on its left, the ones only it talks to on its right, in columns of boxes', () => {
    const g = inside('zd')
    for (const id of ['zone:za', 'zone:zc', 'zone:zm', 'zone:zw']) expect(cx(g.nodes, id)).toBeLessThan(cx(g.nodes, 'zone:zd'))
    expect(cx(g.nodes, 'outside')).toBeGreaterThan(cx(g.nodes, 'zone:zd'))
    const many = Array.from({ length: MAX_BOXES_PER_COLUMN + 2 }, (_, i) => zone(`p${i}`, `peer-${i}`))
    const wide = buildZoneInside({
      zones: [zone('zd', 'db'), ...many], flows: [], members: new Map([['zd', [member(400, 'db-1', ['10.0.4.1'])]]]),
      suggestions: many.map((z, i) => seen(`s${i}`, { src_zone_id: z.id, src_ip: `10.1.0.${i + 1}`, dst_zone_id: 'zd', dst_ip: '10.0.4.1' })), centre: 'zd',
    })
    const columns = new Set(top(wide.nodes).filter(n => n.type === 'zoneBox').map(n => n.position.x))
    expect(columns.size).toBe(2)
  })

  it('draws an exception from the guest of another zone as an edge from its box, one between two of its guests guest to guest', () => {
    const g = inside('zd', { exceptions: [exception('e1'), exception('e2', { sources: [{ type: 'qemu', vmid: 400, name: 'db-1' }], destinations: [{ type: 'qemu', vmid: 403, name: 'db-4' }] })] } as never)
    expect(g.edges.map(e => e.id)).toContain('exception:zone:zw>guest:zd:qemu/402')
    expect(g.edges.map(e => e.id)).toContain('exception:guest:zd:qemu/400>guest:zd:qemu/403')
  })

  it('draws the guests with a flow first in a zone too large to be drawn whole, the rest behind "+N"', () => {
    const big = Array.from({ length: INSIDE_MAX_SHOWN + 20 }, (_, i) => member(1000 + i, `big-${String(i).padStart(3, '0')}`, [`10.7.${Math.floor(i / 200)}.${(i % 200) + 1}`]))
    const last = big[big.length - 1]
    const g = buildZoneInside({
      zones: [zone('zb', 'big'), zone('zw', 'web')], flows: [], members: new Map([['zb', big], ['zw', []]]),
      suggestions: [seen('s1', { src_zone_id: 'zw', src_ip: '10.0.1.1', dst_zone_id: 'zb', dst_ip: last.ips[0] })], centre: 'zb',
    })
    const drawn = g.nodes.filter(n => n.parentId === 'zone:zb')
    expect(drawn.filter(n => n.type === 'guest')).toHaveLength(INSIDE_MAX_SHOWN - 1)
    expect(drawn.find(n => n.type === 'more')!.data).toMatchObject({ count: 21 })
    expect(g.edges.map(e => e.id)).toEqual([`unprotected:zone:zw>guest:zb:${last.key}`])
  })

  it('draws the circle without guests while they are unknown, and nothing for a zone that is gone', () => {
    const g = buildZoneInside({ zones: demo.zones, flows: demo.flows, suggestions: demo.suggestions, centre: 'zd' })
    expect(g.nodes.filter(n => n.parentId)).toHaveLength(0)
    expect((g.nodes.find(n => n.id === 'zone:zd')!.data as unknown as ZoneNodeData).members).toBeNull()
    expect(inside('gone')).toEqual({ nodes: [], edges: [] })
  })
})
