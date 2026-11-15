import { describe, expect, it } from 'vitest'

import type { Point } from './edgeGeometry'
import { placeEdges, type EdgeEnds, type EdgeSpec } from './zoneGraphEdges'

const spec = (id: string, source: string, target: string): EdgeSpec => ({ id, source, target, label: id, small: false })
const box = (x: number, y: number, group: string): EdgeEnds => ({ center: { x, y }, shape: { kind: 'box', halfW: 80, halfH: 20 }, group })
const circle = (x: number, y: number, r: number, group: string): EdgeEnds => ({ center: { x, y }, shape: { kind: 'circle', r }, group })
const middle = (points: Point[]): Point => points[Math.floor(points.length / 2)]
const apart = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

describe('placeEdges: lanes', () => {
  it('draws side by side an edge into a circle and one into a guest of that circle, not on top of each other', () => {
    const ends = new Map<string, EdgeEnds>([
      ['external', box(0, 0, 'external')],
      ['zone:web', circle(500, 300, 120, 'zone:web')],
      ['guest:web:1', circle(505, 310, 12, 'zone:web')],
    ])
    const placed = placeEdges([spec('allowed', 'external', 'zone:web'), spec('unprotected', 'external', 'guest:web:1')], ends, [])
    const a = placed.get('allowed')!
    const b = placed.get('unprotected')!
    expect(apart(middle(a.points), middle(b.points))).toBeGreaterThan(18)
    expect(apart(a.label, b.label)).toBeGreaterThan(18)
  })

  it('keeps the two ways between two guests of one circle on their own sides', () => {
    const ends = new Map<string, EdgeEnds>([
      ['guest:web:1', circle(0, 0, 12, 'zone:web')],
      ['guest:web:2', circle(200, 0, 12, 'zone:web')],
    ])
    const placed = placeEdges([spec('there', 'guest:web:1', 'guest:web:2'), spec('back', 'guest:web:2', 'guest:web:1')], ends, [])
    expect(apart(middle(placed.get('there')!.points), middle(placed.get('back')!.points))).toBeGreaterThan(18)
  })

  it('leaves a lone edge on the straight line between its ends', () => {
    const ends = new Map<string, EdgeEnds>([['a', circle(0, 0, 10, 'zone:a')], ['b', circle(300, 0, 10, 'zone:b')]])
    const lone = placeEdges([spec('only', 'a', 'b')], ends, []).get('only')!
    expect(Math.abs(middle(lone.points).y)).toBeLessThan(1)
  })
})
