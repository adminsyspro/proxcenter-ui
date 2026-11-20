import { describe, expect, it } from 'vitest'
import type { Edge, Node } from '@xyflow/react'

import {
  BACK_OPACITY, BACK_SIZE, CAMERA, MAX_STARS, OUTER_RADIUS, arcPoints, buildConstellation, clamp, depthLook, fibonacciSphere, hiddenChips, hiddenNames, orbitRing, project, rotate,
  sphereRadius, trimmedPath, type Rect,
} from './constellationModel'
import { buildConstellationGraph } from './constellationGraph'
import { demoInput, zone } from './mapViewsTestKit'
import { EXTERNAL_ID, OUTSIDE_ID, UNZONED_ID, zoneNodeId, type MapNodeData, type ZoneGraph } from './zoneGraph'

const length = (p: { x: number; y: number; z: number }) => Math.hypot(p.x, p.y, p.z)
const node = (id: string, data: MapNodeData, parentId?: string): Node => ({ id, position: { x: 0, y: 0 }, data: data as unknown as Node['data'], ...(parentId ? { parentId } : {}) })
const zoneData = (id: string, entered = false): MapNodeData => ({ kind: 'zone', zone: zone(id, id), members: 2, state: 'observe', radius: 0, ...(entered ? { entered } : {}) })
const edge = (id: string, source: string, target: string): Edge => ({ id, source, target, data: {} })
const box = (left: number, top: number, right: number, bottom: number): Rect => ({ left, top, right, bottom })

describe('the places of the constellation', () => {
  it('spreads the stars on the unit sphere, away from the poles, the same for the same count', () => {
    const points = fibonacciSphere(40)
    expect(points).toHaveLength(40)
    for (const p of points) {
      expect(length(p)).toBeCloseTo(1, 6)
      expect(Math.abs(p.y)).toBeLessThan(0.83)
    }
    expect(fibonacciSphere(40)).toEqual(points)
    // No two stars on the same spot.
    expect(new Set(points.map(p => `${p.x.toFixed(3)},${p.y.toFixed(3)}`)).size).toBe(40)
    expect(fibonacciSphere(1)).toEqual([{ x: 1, y: 0, z: 0 }])
    expect(fibonacciSphere(0)).toEqual([])
  })

  it('puts the outer orbit on a tilted circle of its radius', () => {
    const ring = orbitRing(8)
    expect(ring).toHaveLength(8)
    for (const p of ring) expect(length(p)).toBeCloseTo(OUTER_RADIUS, 6)
    expect(ring[0].x).toBeCloseTo(OUTER_RADIUS, 6)
    expect(orbitRing(4, 2, 0, Math.PI)[0].x).toBeCloseTo(-2, 6)
    expect(orbitRing(0)).toEqual([])
  })

  it('turns a point around the vertical axis, then the horizontal one, keeping its distance', () => {
    const p = { x: 1, y: 0, z: 0 }
    const quarter = rotate(p, Math.PI / 2, 0)
    expect(quarter.x).toBeCloseTo(0, 6)
    expect(quarter.z).toBeCloseTo(-1, 6)
    const tilted = rotate({ x: 0, y: 0, z: 1 }, 0, Math.PI / 2)
    expect(tilted.y).toBeCloseTo(-1, 6)
    expect(length(rotate({ x: 0.3, y: -0.4, z: 0.5 }, 1.1, -0.7))).toBeCloseTo(length({ x: 0.3, y: -0.4, z: 0.5 }), 6)
  })

  it('projects the front of the scene larger than its back, with its depth', () => {
    const front = project({ x: 1, y: 0, z: 1 }, 100)
    const back = project({ x: 1, y: 0, z: -1 }, 100)
    expect(front.scale).toBeCloseTo(CAMERA / (CAMERA - 1), 6)
    expect(front.x).toBeGreaterThan(back.x)
    expect(front.depth).toBeGreaterThan(back.depth)
    expect(project({ x: 0, y: 0, z: 0 }, 100)).toEqual({ x: 0, y: 0, scale: 1, depth: 0.5 })
    expect(project({ x: 0, y: 0, z: 9 }, 100).depth).toBe(1)
    expect(project({ x: 0, y: 0, z: -9 }, 100).depth).toBe(0)
  })

  it('draws an arc between two stars from one to the other, bowed away from the centre', () => {
    const a = { x: 1, y: 0, z: 0 }
    const b = { x: 0, y: 0, z: 1 }
    const arc = arcPoints(a, b, 10)
    expect(arc).toHaveLength(11)
    expect(arc[0]).toEqual(a)
    expect(arc[10]).toEqual(b)
    // Further from the centre than the middle of the straight line between them.
    expect(length(arc[5])).toBeGreaterThan(Math.SQRT1_2 + 0.1)
  })

  it('goes over the top of the centre between two opposite stars, and straight from the centre', () => {
    const over = arcPoints({ x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, 4)
    expect(over[2].x).toBeCloseTo(0, 6)
    expect(over[2].y).toBeLessThan(-0.4)
    const radius = arcPoints({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 4)
    for (const p of radius) {
      expect(p.x).toBeCloseTo(0, 6)
      expect(p.y).toBeCloseTo(0, 6)
    }
  })
})

describe('the scene of a map graph', () => {
  it('puts the zones and the guests in no zone on the sphere, Unknown / External and Outside on the outer orbit', () => {
    const graph = buildConstellationGraph(demoInput())
    const scene = buildConstellation(graph)
    expect(scene.centre).toBeNull()
    expect(scene.more).toBe(0)
    const shells = new Map(scene.stars.map(s => [s.id, s.shell]))
    expect(shells.get(zoneNodeId('zw'))).toBe('sphere')
    expect(shells.get(UNZONED_ID)).toBe('sphere')
    expect(shells.get(EXTERNAL_ID)).toBe('outer')
    expect(shells.get(OUTSIDE_ID)).toBe('outer')
    // Every edge of the graph is a link between two stars.
    expect(scene.links).toHaveLength(graph.edges.length)
    for (const s of scene.stars) if (s.shell === 'sphere') expect(length(s.at)).toBeCloseTo(1, 6)
  })

  it('puts an entered zone in the centre, its guests on the sphere, the rest outside; a guest of another circle is drawn by its circle', () => {
    const graph: ZoneGraph = {
      nodes: [
        node('zone:a', zoneData('a', true)),
        node('guest:a:qemu/1', { kind: 'guest', member: { key: 'qemu/1', name: 'a-1', vmid: 1, node: 'pve1', type: 'qemu', status: 'running', ips: [], pending: false }, groupId: 'a' }, 'zone:a'),
        node('guest:a:qemu/2', { kind: 'guest', member: { key: 'qemu/2', name: 'a-2', vmid: 2, node: 'pve1', type: 'qemu', status: 'running', ips: [], pending: false }, groupId: 'a' }, 'zone:a'),
        node('zone:b', zoneData('b')),
        node('guest:b:qemu/3', { kind: 'guest', member: { key: 'qemu/3', name: 'b-1', vmid: 3, node: 'pve1', type: 'qemu', status: 'running', ips: [], pending: false }, groupId: 'b' }, 'zone:b'),
        node('ip:10.0.0.9', { kind: 'ip', ip: '10.0.0.9' }),
      ],
      edges: [edge('e1', 'guest:a:qemu/1', 'guest:b:qemu/3'), edge('e2', 'guest:a:qemu/2', 'zone:a'), edge('e3', 'ip:10.0.0.9', 'guest:a:qemu/1'), edge('e4', 'guest:a:qemu/1', 'gone')],
    }
    const scene = buildConstellation(graph)
    expect(scene.centre?.id).toBe('zone:a')
    const shells = Object.fromEntries(scene.stars.map(s => [s.id, s.shell]))
    expect(shells).toEqual({ 'guest:a:qemu/1': 'sphere', 'guest:a:qemu/2': 'sphere', 'zone:b': 'outer', 'ip:10.0.0.9': 'outer' })
    expect(scene.stars.find(s => s.id === 'zone:b')?.folded).toBe(1)
    expect(scene.links.map(l => `${l.source}>${l.target}`)).toEqual(['guest:a:qemu/1>zone:b', 'guest:a:qemu/2>zone:a', 'ip:10.0.0.9>guest:a:qemu/1'])
  })

  it(`folds the stars past ${MAX_STARS} in a "+N" that carries their links`, () => {
    const nodes = Array.from({ length: 8 }, (_, i) => node(`zone:z${i}`, zoneData(`z${i}`)))
    const scene = buildConstellation({ nodes, edges: [edge('e', 'zone:z0', 'zone:z7'), edge('f', 'zone:z6', 'zone:z7')] }, 5)
    expect(scene.stars).toHaveLength(5)
    expect(scene.more).toBe(4)
    const more = scene.stars.find(s => s.id === 'constellation:more')!
    expect(more.folded).toBe(4)
    expect(more.data).toEqual({ kind: 'more', count: 4, groupId: '' })
    // Both ends folded in the same star: the link is not drawn.
    expect(scene.links.map(l => `${l.source}>${l.target}`)).toEqual(['zone:z0>constellation:more'])
  })
})

describe('the look of the scene', () => {
  it('shrinks and pales a star at the back, and keeps the zoom and the angles in their bounds', () => {
    expect(depthLook(1)).toEqual({ size: 1, opacity: 1 })
    expect(depthLook(0)).toEqual({ size: BACK_SIZE, opacity: BACK_OPACITY })
    expect(clamp(5, 0, 2)).toBe(2)
    expect(clamp(-1, 0, 2)).toBe(0)
    expect(clamp(1, 0, 2)).toBe(1)
  })

  it('sizes the sphere to its box, never under 60 px', () => {
    expect(sphereRadius(2000, 600)).toBe(198)
    expect(sphereRadius(500, 1000)).toBe(105)
    expect(sphereRadius(10, 10)).toBe(60)
  })

  it('cuts an arc short of the discs it joins', () => {
    const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 0 }]
    expect(trimmedPath(points, 5, 5)).toBe('M5.0 0.0L10.0 0.0L20.0 0.0L25.0 0.0')
    // A gap past the first point skips it.
    expect(trimmedPath(points, 12, 0)).toBe('M12.0 0.0L20.0 0.0L30.0 0.0')
    expect(trimmedPath([{ x: 0, y: 0 }], 1, 1)).toBe('')
  })
})

describe('the names and the labels that are not drawn', () => {
  it('keeps the names of the front, hides one that would cover a nearer disc, name or the centre', () => {
    const hidden = hiddenNames([
      { id: 'front', depth: 0.9, disc: box(0, 0, 10, 10), name: box(-10, 12, 20, 24) },
      { id: 'back', depth: 0.2, disc: box(2, 30, 8, 36), name: box(-5, 14, 15, 22) },
      { id: 'far', depth: 0.1, disc: box(100, 100, 110, 110), name: box(95, 112, 115, 120) },
      { id: 'nameless', depth: 0.5, disc: box(200, 200, 210, 210), name: null },
      { id: 'centre', depth: 0.8, disc: box(300, 300, 310, 310), name: box(290, 312, 320, 320) },
    ], [box(285, 310, 325, 330)])
    expect([...hidden].sort((a, b) => a.localeCompare(b))).toEqual(['back', 'centre'])
  })

  it('always draws the name of a selected pastille, whatever covers it', () => {
    const hidden = hiddenNames([
      { id: 'front', depth: 0.9, disc: box(0, 0, 10, 10), name: box(-10, 12, 20, 24) },
      { id: 'picked', depth: 0.1, disc: box(2, 30, 8, 36), name: box(-5, 14, 15, 22), pinned: true },
    ])
    expect([...hidden]).toEqual(['front'])
  })

  it('hides a flow label that covers a pastille or a label of a higher rank, never the one under the pointer', () => {
    const taken = [box(0, 0, 10, 10)]
    const hidden = hiddenChips([
      { id: 'on-disc', box: box(5, 5, 15, 15), rank: 3 },
      { id: 'lit', box: box(50, 50, 70, 60), rank: 2.5 },
      { id: 'dim', box: box(60, 55, 80, 65), rank: 0.5 },
      { id: 'pointed', box: box(2, 2, 8, 8), rank: 0, pinned: true },
    ], taken)
    expect([...hidden].sort((a, b) => a.localeCompare(b))).toEqual(['dim', 'on-disc'])
  })
})
