import { describe, expect, it } from 'vitest'

import { edgeGeometry } from './FlowEdge'

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
