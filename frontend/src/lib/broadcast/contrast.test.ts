import { describe, expect, it } from 'vitest'

import { MIN_CONTRAST_RATIO, contrastRatio } from './contrast'

describe('contrastRatio', () => {
  it('returns the maximum ratio for black on white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1)
  })

  it('returns 1 for identical colours', () => {
    expect(contrastRatio('#f59e0b', '#f59e0b')).toBeCloseTo(1, 5)
  })

  it('is symmetric', () => {
    expect(contrastRatio('#123456', '#abcdef')).toBeCloseTo(contrastRatio('#abcdef', '#123456')!, 10)
  })

  it('flags the readable default pair as passing', () => {
    expect(contrastRatio('#000000', '#f59e0b')!).toBeGreaterThan(MIN_CONTRAST_RATIO)
  })

  it('flags an unreadable pair as failing', () => {
    expect(contrastRatio('#7f1d1d', '#111827')!).toBeLessThan(MIN_CONTRAST_RATIO)
  })

  it('accepts uppercase hex', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 1)
  })

  it('returns null for an unparseable value', () => {
    expect(contrastRatio('red', '#000000')).toBeNull()
    expect(contrastRatio('#fff', '#000000')).toBeNull()
    expect(contrastRatio('', '#000000')).toBeNull()
    expect(contrastRatio('#000000', 'red')).toBeNull()
  })
})
