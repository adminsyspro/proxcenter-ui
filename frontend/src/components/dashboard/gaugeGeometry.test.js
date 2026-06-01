import { describe, it, expect } from 'vitest'
import { gaugeGeometry, GAUGE_VIEWBOX, GAUGE_STROKE } from './gaugeGeometry'

describe('gaugeGeometry', () => {
  const radius = (GAUGE_VIEWBOX - GAUGE_STROKE) / 2
  const circumference = 2 * Math.PI * radius

  it('derives center/radius/circumference from the normalized viewBox', () => {
    const g = gaugeGeometry(0)
    expect(g.center).toBe(GAUGE_VIEWBOX / 2)
    expect(g.radius).toBeCloseTo(radius, 6)
    expect(g.circumference).toBeCloseTo(circumference, 6)
    expect(g.strokeWidth).toBe(GAUGE_STROKE)
  })

  it('empty gauge (fraction 0) has full dash offset', () => {
    expect(gaugeGeometry(0).dashoffset).toBeCloseTo(circumference, 6)
  })

  it('full gauge (fraction 1) has zero dash offset', () => {
    expect(gaugeGeometry(1).dashoffset).toBeCloseTo(0, 6)
  })

  it('half gauge offsets by half the circumference', () => {
    expect(gaugeGeometry(0.5).dashoffset).toBeCloseTo(circumference / 2, 6)
  })

  it('clamps fractions below 0 and above 1', () => {
    expect(gaugeGeometry(-3).dashoffset).toBeCloseTo(circumference, 6)
    expect(gaugeGeometry(5).dashoffset).toBeCloseTo(0, 6)
  })

  it('treats non-finite input as empty', () => {
    expect(gaugeGeometry(NaN).dashoffset).toBeCloseTo(circumference, 6)
    expect(gaugeGeometry(undefined).dashoffset).toBeCloseTo(circumference, 6)
  })

  it('honors a custom stroke width', () => {
    const g = gaugeGeometry(0, 5)
    expect(g.strokeWidth).toBe(5)
    expect(g.radius).toBeCloseTo((GAUGE_VIEWBOX - 5) / 2, 6)
  })
})
