import { describe, expect, it } from 'vitest'

import { crossesBox, edgeGeometry } from './edgeGeometry'

const box = { halfW: 100, halfH: 22, gap: 4 }

describe('edgeGeometry', () => {
  it('starts and ends a horizontal edge on the side of the two boxes', () => {
    const g = edgeGeometry({ x: 0, y: 0 }, { x: 400, y: 0 }, { ...box, offset: 0 })!
    expect(g.start).toEqual({ x: 104, y: 0 })
    expect(g.end).toEqual({ x: 296, y: 0 })
    expect(g.mid).toEqual({ x: 200, y: 0 })
  })

  it('starts and ends a vertical edge on the top and the bottom', () => {
    const g = edgeGeometry({ x: 0, y: 0 }, { x: 0, y: 200 }, { ...box, offset: 0 })!
    expect(g.start).toEqual({ x: 0, y: 26 })
    expect(g.end).toEqual({ x: 0, y: 174 })
  })

  it('keeps a diagonal edge outside the boxes', () => {
    const g = edgeGeometry({ x: 0, y: 0 }, { x: 300, y: 150 }, { ...box, offset: 0 })!
    expect(Math.abs(g.start.x) > 100 || Math.abs(g.start.y) > 22).toBe(true)
    expect(Math.abs(g.end.x - 300) > 100 || Math.abs(g.end.y - 150) > 22).toBe(true)
  })

  it('shifts the edge along its normal, and the opposite direction the other way', () => {
    const forward = edgeGeometry({ x: 0, y: 0 }, { x: 400, y: 0 }, { ...box, offset: 7 })!
    const backward = edgeGeometry({ x: 400, y: 0 }, { x: 0, y: 0 }, { ...box, offset: 7 })!
    expect(forward.start.y).toBe(7)
    expect(backward.start.y).toBe(-7)
  })

  it('draws nothing between two nodes on the same spot', () => {
    expect(edgeGeometry({ x: 5, y: 5 }, { x: 5, y: 5 }, { ...box, offset: 0 })).toBeNull()
  })

  it('draws nothing when the nodes touch', () => {
    expect(edgeGeometry({ x: 0, y: 0 }, { x: 150, y: 0 }, { ...box, offset: 0 })).toBeNull()
  })
})

describe('edgeGeometry curves and labels', () => {
  it('bows the middle of the edge along its normal', () => {
    const straight = edgeGeometry({ x: 0, y: 0 }, { x: 400, y: 0 }, { ...box, offset: 0 })!
    const bowed = edgeGeometry({ x: 0, y: 0 }, { x: 400, y: 0 }, { ...box, offset: 0, bow: 60 })!
    expect(straight.mid.y).toBe(0)
    expect(bowed.mid.y).toBeGreaterThan(50)
    expect(bowed.path).toMatch(/^M .* Q .*/)
    // It leaves the first box and reaches the second one from outside them.
    expect(Math.abs(bowed.start.x) >= 104 || Math.abs(bowed.start.y) >= 26).toBe(true)
    expect(Math.abs(bowed.end.x - 400) >= 104 || Math.abs(bowed.end.y) >= 26).toBe(true)
  })

  it('puts the label at the asked place along the edge', () => {
    const at = (fraction: number) => edgeGeometry({ x: 0, y: 0 }, { x: 400, y: 0 }, { ...box, offset: 0, at: fraction })!.mid.x
    expect(at(0.5)).toBe(200)
    expect(at(0.4)).toBeCloseTo(104 + 0.4 * 192, 1)
    expect(at(0.6)).toBeCloseTo(104 + 0.6 * 192, 1)
  })

  it('gives the points of the visible edge, to check it against other boxes', () => {
    const g = edgeGeometry({ x: 0, y: 0 }, { x: 800, y: 0 }, { ...box, offset: 0 })!
    expect(crossesBox(g.points, { x: 400, y: 0 }, 100, 22, 0)).toBe(true)
    expect(crossesBox(g.points, { x: 400, y: 200 }, 100, 22, 0)).toBe(false)
    expect(g.points.length).toBeGreaterThan(10)
  })
})
