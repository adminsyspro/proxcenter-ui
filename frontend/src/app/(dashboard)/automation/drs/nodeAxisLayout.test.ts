import { describe, expect, it } from 'vitest'

import { computeNodeAxisLayout, createTextMeasurer, truncateToWidth } from './nodeAxisLayout'

const perChar = (s: string) => s.length * 6

describe('computeNodeAxisLayout', () => {
  it('keeps names horizontal when they fit under their bars', () => {
    expect(computeNodeAxisLayout([60, 60, 60], 600)).toEqual({ mode: 'horizontal', height: 30 })
  })

  it('stays horizontal with no node or before the width is known', () => {
    expect(computeNodeAxisLayout([], 600).mode).toBe('horizontal')
    expect(computeNodeAxisLayout([60], 0).mode).toBe('horizontal')
  })

  it('tilts names that would overlap, as with 22 nodes named PROXMOX-RBX1PRD1', () => {
    const layout = computeNodeAxisLayout(Array(22).fill(95), 1500, 40)

    expect(layout.mode).toBe('tilted')
    if (layout.mode !== 'tilted') return
    expect(layout.maxLabelWidth).toBe(95)
    expect(layout.height).toBeGreaterThan(30)
    expect(layout.leftPad).toBe(0)
  })

  it('caps the tilted label width and pads the left edge when slots are narrow', () => {
    const layout = computeNodeAxisLayout(Array(60).fill(200), 1200, 0)

    expect(layout.mode).toBe('tilted')
    if (layout.mode !== 'tilted') return
    expect(layout.maxLabelWidth).toBe(120)
    expect(layout.leftPad).toBeGreaterThan(0)
  })

  it('hides names when even tilted they would collide', () => {
    expect(computeNodeAxisLayout(Array(100).fill(80), 1000).mode).toBe('hidden')
  })
})

describe('truncateToWidth', () => {
  it('leaves a name that fits untouched', () => {
    expect(truncateToWidth('pve1', 60, perChar)).toBe('pve1')
  })

  it('shortens a long name in its middle, keeping the end that tells nodes apart', () => {
    const one = truncateToWidth('PROXMOX-RBX1PRD1', 60, perChar)
    const two = truncateToWidth('PROXMOX-RBX1PRD2', 60, perChar)

    expect(one).toContain('…')
    expect(one.endsWith('1')).toBe(true)
    expect(one).not.toBe(two)
    expect(perChar(one)).toBeLessThanOrEqual(60)
  })

  it('falls back to the ellipsis alone when nothing fits', () => {
    expect(truncateToWidth('abc', 1, perChar)).toBe('…')
  })
})

describe('createTextMeasurer', () => {
  it('returns a width growing with the text length', () => {
    const measure = createTextMeasurer('10px sans-serif')

    expect(measure('abcdef')).toBeGreaterThanOrEqual(measure('abc'))
  })
})
