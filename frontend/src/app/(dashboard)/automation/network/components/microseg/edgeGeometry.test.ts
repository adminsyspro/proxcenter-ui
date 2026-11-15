import { describe, expect, it } from 'vitest'

import { crossesBox, crossesCircle, edgeGeometry, rectAround, rectHitsCircle, rectsOverlap, type EndShape } from './edgeGeometry'

const BOX: EndShape = { kind: 'box', halfW: 100, halfH: 22 }
const box = { fromShape: BOX, toShape: BOX, gap: 4 }
const circle = (r: number): EndShape => ({ kind: 'circle', r })

describe('edgeGeometry on boxes', () => {
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

  it('shifts the edge along its normal, and the opposite direction the other way', () => {
    const forward = edgeGeometry({ x: 0, y: 0 }, { x: 400, y: 0 }, { ...box, offset: 7 })!
    const backward = edgeGeometry({ x: 400, y: 0 }, { x: 0, y: 0 }, { ...box, offset: 7 })!
    expect(forward.start.y).toBe(7)
    expect(backward.start.y).toBe(-7)
  })

  it('draws nothing between two nodes on the same spot, or when the nodes touch', () => {
    expect(edgeGeometry({ x: 5, y: 5 }, { x: 5, y: 5 }, { ...box, offset: 0 })).toBeNull()
    expect(edgeGeometry({ x: 0, y: 0 }, { x: 150, y: 0 }, { ...box, offset: 0 })).toBeNull()
  })
})

describe('edgeGeometry on circles', () => {
  it('clips the edge on the rim of each circle, the gap kept', () => {
    const g = edgeGeometry({ x: 0, y: 0 }, { x: 500, y: 0 }, { fromShape: circle(110), toShape: circle(150), gap: 4, offset: 0 })!
    expect(g.start.x).toBeCloseTo(114, 0)
    expect(g.end.x).toBeCloseTo(346, 0)
  })

  it('goes from a box to a circle', () => {
    const g = edgeGeometry({ x: 0, y: 0 }, { x: 500, y: 0 }, { fromShape: BOX, toShape: circle(110), gap: 4, offset: 0 })!
    expect(g.start.x).toBeCloseTo(104, 0)
    expect(g.end.x).toBeCloseTo(386, 0)
  })
})

describe('edgeGeometry curves', () => {
  it('bows the middle of the edge along its normal', () => {
    const straight = edgeGeometry({ x: 0, y: 0 }, { x: 400, y: 0 }, { ...box, offset: 0 })!
    const bowed = edgeGeometry({ x: 0, y: 0 }, { x: 400, y: 0 }, { ...box, offset: 0, bow: 60 })!
    expect(straight.mid.y).toBe(0)
    expect(bowed.mid.y).toBeGreaterThan(50)
    expect(bowed.path).toMatch(/^M .* Q .*/)
  })

  it('gives any point along the edge', () => {
    const g = edgeGeometry({ x: 0, y: 0 }, { x: 400, y: 0 }, { ...box, offset: 0, at: 0.4 })!
    expect(g.mid.x).toBeCloseTo(104 + 0.4 * 192, 1)
    expect(g.pointAt(0.6).x).toBeCloseTo(104 + 0.6 * 192, 1)
  })

  it('gives the points of the visible edge, to check it against other nodes', () => {
    const g = edgeGeometry({ x: 0, y: 0 }, { x: 800, y: 0 }, { ...box, offset: 0 })!
    expect(crossesBox(g.points, { x: 400, y: 0 }, 100, 22, 0)).toBe(true)
    expect(crossesBox(g.points, { x: 400, y: 200 }, 100, 22, 0)).toBe(false)
    expect(crossesCircle(g.points, { x: 400, y: 100 }, 90, 0)).toBe(false)
    expect(crossesCircle(g.points, { x: 400, y: 100 }, 90, 12)).toBe(true)
  })
})

describe('rectangles', () => {
  it('tells when two labels overlap and when a label enters a circle', () => {
    const a = rectAround({ x: 0, y: 0 }, 100, 20)
    expect(rectsOverlap(a, rectAround({ x: 0, y: 19 }, 100, 20))).toBe(true)
    expect(rectsOverlap(a, rectAround({ x: 0, y: 21 }, 100, 20))).toBe(false)
    expect(rectsOverlap(a, rectAround({ x: 0, y: 21 }, 100, 20), 2)).toBe(true)
    expect(rectHitsCircle(a, { x: 0, y: 100 }, 89)).toBe(false)
    expect(rectHitsCircle(a, { x: 0, y: 100 }, 91)).toBe(true)
    expect(rectHitsCircle(a, { x: 70, y: 0 }, 21)).toBe(true)
  })
})
