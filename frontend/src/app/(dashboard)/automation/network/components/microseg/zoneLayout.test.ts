import { describe, expect, it } from 'vitest'

import {
  CELL_H, CELL_W, GUEST_H, GUEST_W, MAX_R, MAX_SHOWN, MIN_R, circleRadius, gridShape, layerZones, memberSlots, orderLayers, slotPositions,
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
