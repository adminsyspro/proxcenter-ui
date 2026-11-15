import { describe, expect, it, vi } from 'vitest'

vi.mock('@xyflow/react', async () => (await import('./xyflowTestMock')).xyflowMock)

import { circleTitleSx, topChord } from './ZoneNode'

describe('circle title', () => {
  it('takes the width its text needs, at least the chord of the circle, centred', () => {
    const sx = circleTitleSx(110)
    expect(sx.width).toBe('max-content')
    expect(sx.minWidth).toBe(topChord(110))
    expect(sx.left).toBe('50%')
    expect(sx.transform).toBe('translateX(-50%)')
  })

  it('never gives a small circle a title line under 60 px', () => {
    expect(topChord(30)).toBe(60)
    expect(topChord(200)).toBeGreaterThan(60)
  })
})
