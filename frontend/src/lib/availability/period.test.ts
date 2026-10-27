import { describe, expect, it } from 'vitest'

import { isPeriod, parsePeriod, periodBounds } from './period'

describe('periodBounds', () => {
  const now = new Date('2026-10-27T10:15:30.500Z')

  it.each([
    ['1h', 60, '2026-10-27T09:16:00.000Z', '2026-10-27T10:16:00.000Z'],
    ['24h', 60, '2026-10-26T10:16:00.000Z', '2026-10-27T10:16:00.000Z'],
    ['7d', 600, '2026-10-20T10:20:00.000Z', '2026-10-27T10:20:00.000Z'],
    ['30d', 3600, '2026-09-27T11:00:00.000Z', '2026-10-27T11:00:00.000Z'],
  ] as const)('%s: slot of %i s, end rounded up to the slot', (p, slotSeconds, from, to) => {
    expect(periodBounds(p, now)).toEqual({ from, to, slotSeconds })
  })

  it('keeps an end already on a slot boundary', () => {
    expect(periodBounds('24h', new Date('2026-10-27T10:00:00Z')).to).toBe('2026-10-27T10:00:00.000Z')
  })

  it('stays within the orchestrator bounds: 1440 slots at most', () => {
    for (const p of ['1h', '24h', '7d', '30d'] as const) {
      const { from, to, slotSeconds } = periodBounds(p, now)
      expect((Date.parse(to) - Date.parse(from)) / 1000 / slotSeconds).toBeLessThanOrEqual(1440)
    }
    const { from, to } = periodBounds('24h', now)
    expect(Date.parse(to) - Date.parse(from)).toBe(24 * 3600 * 1000)
  })
})

describe('parsePeriod', () => {
  it('falls back when absent and refuses an unknown value', () => {
    expect(parsePeriod(null, '24h')).toBe('24h')
    expect(parsePeriod('', '30d')).toBe('30d')
    expect(parsePeriod('7d', '24h')).toBe('7d')
    expect(parsePeriod('90d', '24h')).toBeNull()
    expect(isPeriod('1h')).toBe(true)
    expect(isPeriod(24)).toBe(false)
  })
})
