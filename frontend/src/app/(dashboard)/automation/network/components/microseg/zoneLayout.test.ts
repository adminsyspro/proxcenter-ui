import { describe, expect, it } from 'vitest'

import {
  CELL_H, CELL_W, GUEST_H, GUEST_W, MAX_R, MAX_SHOWN, MIN_R, circleRadius, gridShape, layerZones, memberSlots, orderLayers, slotPositions,
  foldColumns, gridExtent, INSIDE_GUEST_W, INSIDE_MAX_SHOWN, INSIDE_MIN_R, insideSlots, ringLayout,
} from './zoneLayout'

describe('zone circles', () => {
  it('grows the circle with the guests it holds, within the bounds', () => {
    const radii = Array.from({ length: MAX_SHOWN + 1 }, (_, n) => circleRadius(n))
    expect(radii[0]).toBe(MIN_R)
    expect(radii[1]).toBe(MIN_R)
    for (let n = 1; n < radii.length; n++) expect(radii[n]).toBeGreaterThanOrEqual(radii[n - 1])
    expect(radii[MAX_SHOWN]).toBeGreaterThan(MIN_R)
    expect(radii[MAX_SHOWN]).toBeLessThanOrEqual(MAX_R)
    expect(circleRadius(400)).toBe(MAX_R)
  })

  it('draws up to 12 guests, then the first 11 and a "+N" for the rest', () => {
    expect(memberSlots(0)).toEqual({ shown: 0, more: 0 })
    expect(memberSlots(12)).toEqual({ shown: 12, more: 0 })
    expect(memberSlots(13)).toEqual({ shown: 11, more: 2 })
    expect(memberSlots(250)).toEqual({ shown: 11, more: 239 })
  })

  it('lays the guests on a near-square grid', () => {
    expect(gridShape(1)).toEqual({ cols: 1, rows: 1 })
    expect(gridShape(4)).toEqual({ cols: 2, rows: 2 })
    expect(gridShape(8)).toEqual({ cols: 3, rows: 3 })
    expect(gridShape(12)).toEqual({ cols: 4, rows: 3 })
  })

  it.each([1, 2, 3, 4, 5, 6, 8, 9, 11, 12])('keeps %i guests inside their circle, none on another', slots => {
    const r = circleRadius(slots)
    const spots = slotPositions(slots, r)
    expect(spots).toHaveLength(slots)
    for (const p of spots) {
      for (const [cx, cy] of [[p.x, p.y], [p.x + GUEST_W, p.y], [p.x, p.y + GUEST_H], [p.x + GUEST_W, p.y + GUEST_H]]) {
        expect(Math.hypot(cx - r, cy - r), `${slots}: ${cx},${cy}`).toBeLessThan(r)
      }
    }
    for (const [i, a] of spots.entries()) {
      for (const b of spots.slice(i + 1)) expect(Math.abs(a.x - b.x) >= GUEST_W || Math.abs(a.y - b.y) >= GUEST_H).toBe(true)
    }
    // The name of the zone sits above the guests.
    expect(Math.min(...spots.map(p => p.y))).toBeGreaterThanOrEqual(36)
    expect(CELL_W).toBeGreaterThan(GUEST_W)
    expect(CELL_H).toBeGreaterThan(GUEST_H)
  })
})

describe('layering of the zones', () => {
  const ids = ['ext-web', 'admin', 'app', 'db', 'cache', 'mon']
  const flows: Array<[string, string]> = [
    ['ext-web', 'app'], ['admin', 'app'], ['app', 'db'], ['app', 'cache'],
    ['mon', 'ext-web'], ['mon', 'admin'], ['mon', 'app'], ['mon', 'db'], ['mon', 'cache'],
  ]

  it('puts a zone one column after its furthest source, and a zone that only sends at the first zone column', () => {
    const layer = layerZones(ids, flows)
    expect(layer.get('mon')).toBe(1)
    expect(layer.get('ext-web')).toBe(2)
    expect(layer.get('admin')).toBe(2)
    expect(layer.get('app')).toBe(3)
    expect(layer.get('db')).toBe(4)
    expect(layer.get('cache')).toBe(4)
  })

  it('puts a zone with no flow in the first zone column', () => {
    expect(layerZones(['a', 'b'], []).get('a')).toBe(1)
  })

  it('breaks a cycle instead of looping', () => {
    const layer = layerZones(['a', 'b', 'c'], [['a', 'b'], ['b', 'c'], ['c', 'a']])
    expect([layer.get('a'), layer.get('b'), layer.get('c')]).toEqual([1, 2, 3])
  })

  it('ignores flows inside a zone and flows to unknown zones', () => {
    const layer = layerZones(['a', 'b'], [['a', 'a'], ['a', 'zz'], ['zz', 'b']])
    expect(layer.get('a')).toBe(1)
    expect(layer.get('b')).toBe(1)
  })
})

describe('rows of the zones', () => {
  const name = (id: string) => id

  it('sorts a column by the mean row of its sources, so related zones stay side by side', () => {
    // Column 1: a (top), b (bottom). Column 2: x gets its flow from b, y from a: y goes on top.
    const edges: Array<[string, string]> = [['a', 'y'], ['b', 'x']]
    const layer = layerZones(['a', 'b', 'x', 'y'], edges)
    const columns = orderLayers(layer, edges, name)
    expect(columns[1]).toEqual(['a', 'b'])
    expect(columns[2]).toEqual(['y', 'x'])
  })

  it('is deterministic: the same input gives the same order, whatever the order of the lists, ties by name', () => {
    const edges: Array<[string, string]> = [['m', 'p'], ['m', 'q'], ['m', 'r'], ['n', 'r']]
    const a = orderLayers(layerZones(['m', 'n', 'p', 'q', 'r'], edges), edges, name)
    const b = orderLayers(layerZones(['r', 'q', 'p', 'n', 'm'], [...edges].reverse()), [...edges].reverse(), name)
    expect(b).toEqual(a)
    expect(a[2]).toEqual(['p', 'q', 'r'])
  })
})

describe('layering with External', () => {
  it('starts the walk from the zones External sends to, so that the reply is the edge dropped from a cycle', () => {
    const edges: Array<[string, string]> = [['app', 'web'], ['web', 'app'], ['app', 'db']]
    const layer = layerZones(['app', 'db', 'web'], edges, ['web'])
    expect([layer.get('web'), layer.get('app'), layer.get('db')]).toEqual([1, 2, 3])
  })
})

describe('foldColumns', () => {
  const cell = (id: string, size = 300) => ({ id, w: size, h: size })
  const column = (prefix: string, count: number, size = 300) => Array.from({ length: count }, (_, i) => cell(`${prefix}${i + 1}`, size))
  const ids = (grid: { id: string }[][]) => grid.map(c => c.map(x => x.id).join(' '))

  it('leaves a map that reads well as it is: its columns are its layers', () => {
    const grid = [column('a', 2), column('b', 3), column('c', 1)]
    expect(foldColumns(grid, 240, 90)).toBe(grid)
  })

  it('folds one long column of zones into even columns, the order kept top to bottom then left to right', () => {
    // 11 circles of 300 one above the other: 4 200 px tall, fitted at 0.17. Three rows fit the view best.
    const folded = foldColumns([column('z', 11)], 240, 90)
    expect(ids(folded)).toEqual(['z1 z2 z3', 'z4 z5 z6', 'z7 z8 z9', 'z10 z11'])
    const before = gridExtent([column('z', 11)], 240, 90)
    const after = gridExtent(folded, 240, 90)
    expect(before).toEqual({ width: 300, height: 4200 })
    expect(after).toEqual({ width: 1920, height: 1080 })
  })

  it('keeps the columns of one layer next to each other, between the layers before and after it', () => {
    const folded = foldColumns([column('ext', 1, 100), column('z', 8), column('out', 1, 100)], 240, 90)
    expect(ids(folded)).toEqual(['ext1', 'z1 z2 z3', 'z4 z5 z6', 'z7 z8', 'out1'])
  })

  it('folds every column that is too tall, not only the tallest', () => {
    const folded = foldColumns([column('a', 9), column('b', 6)], 240, 90)
    expect(folded.every(c => c.length <= 3)).toBe(true)
    expect(folded.flat().map(c => c.id)).toEqual([...column('a', 9), ...column('b', 6)].map(c => c.id))
  })

  it('judges the boxes of the compact view by their own size: eleven small boxes still need folding, five do not', () => {
    const box = (count: number) => Array.from({ length: count }, (_, i) => ({ id: `b${i}`, w: 190, h: 64 }))
    expect(foldColumns([box(5)], 130, 80)).toHaveLength(1)
    expect(foldColumns([box(11)], 130, 80).length).toBeGreaterThan(1)
  })

  it('returns an empty grid as it is', () => {
    expect(foldColumns([], 240, 90)).toEqual([])
  })
})

describe('the rings of an entered zone', () => {
  it('draws up to 60 guests, then the first 59 and a "+N" for the rest', () => {
    expect(insideSlots(0)).toEqual({ shown: 0, more: 0 })
    expect(insideSlots(INSIDE_MAX_SHOWN)).toEqual({ shown: INSIDE_MAX_SHOWN, more: 0 })
    expect(insideSlots(INSIDE_MAX_SHOWN + 1)).toEqual({ shown: INSIDE_MAX_SHOWN - 1, more: 2 })
    expect(insideSlots(250)).toEqual({ shown: INSIDE_MAX_SHOWN - 1, more: 250 - (INSIDE_MAX_SHOWN - 1) })
  })

  it('leaves an empty zone its circle and puts a single guest in the middle', () => {
    expect(ringLayout(0)).toEqual({ radius: INSIDE_MIN_R, centers: [] })
    expect(ringLayout(1)).toEqual({ radius: INSIDE_MIN_R, centers: [{ x: 0, y: 0 }] })
  })

  it('spreads the guests on rings: one place each, inside the circle, far enough apart for their names', () => {
    for (const slots of [2, 3, 6, 7, 12, 18, 33, INSIDE_MAX_SHOWN]) {
      const { radius, centers } = ringLayout(slots)
      expect(centers).toHaveLength(slots)
      for (const c of centers) expect(Math.hypot(c.x, c.y)).toBeLessThan(radius - 40)
      for (let i = 0; i < centers.length; i++) {
        for (let j = i + 1; j < centers.length; j++) {
          const apart = Math.hypot(centers[i].x - centers[j].x, centers[i].y - centers[j].y)
          // Two guests never overlap: side by side they are a guest width apart, one above the other a ring apart.
          expect(apart, `${slots} guests, ${i} and ${j}`).toBeGreaterThanOrEqual(Math.min(INSIDE_GUEST_W, 100))
        }
      }
    }
  })

  it('grows the circle with the guests and is the same on every call', () => {
    expect(ringLayout(6).radius).toBeLessThan(ringLayout(7).radius)
    expect(ringLayout(17).radius).toBeLessThan(ringLayout(18).radius)
    expect(ringLayout(33)).toEqual(ringLayout(33))
  })
})
