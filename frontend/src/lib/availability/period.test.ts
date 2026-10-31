import { describe, expect, it } from 'vitest'

import { isPeriod, parsePeriod, parseWindow, periodBounds, rangeBounds, rangeError, windowQuery } from './period'

describe('periodBounds', () => {
  const now = new Date('2026-10-27T10:15:30.500Z')

  it.each([
    ['1h', 60, '2026-10-27T09:16:00.000Z', '2026-10-27T10:16:00.000Z'],
    ['24h', 60, '2026-10-26T10:16:00.000Z', '2026-10-27T10:16:00.000Z'],
    ['7d', 600, '2026-10-20T10:20:00.000Z', '2026-10-27T10:20:00.000Z'],
    ['30d', 3600, '2026-09-27T11:00:00.000Z', '2026-10-27T11:00:00.000Z'],
    ['1y', 86400, '2025-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z'],
  ] as const)('%s: slot of %i s, end rounded up to the slot', (p, slotSeconds, from, to) => {
    expect(periodBounds(p, now)).toEqual({ from, to, slotSeconds })
  })

  it('keeps an end already on a slot boundary', () => {
    expect(periodBounds('24h', new Date('2026-10-27T10:00:00Z')).to).toBe('2026-10-27T10:00:00.000Z')
  })

  it('stays within the orchestrator bounds: 1440 slots at most', () => {
    for (const p of ['1h', '24h', '7d', '30d', '1y'] as const) {
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

describe('a range picked by hand', () => {
  const now = new Date('2026-10-29T12:34:00.000Z')

  it.each([
    ['six hours: minutes', '2026-10-27T08:00:30.000Z', '2026-10-27T14:00:00.000Z', 60, '2026-10-27T08:00:00.000Z', '2026-10-27T14:00:00.000Z'],
    ['three days: 10 minutes', '2026-10-20T08:05:00.000Z', '2026-10-23T08:00:00.000Z', 600, '2026-10-20T08:00:00.000Z', '2026-10-23T08:00:00.000Z'],
    ['fifty days: hours', '2026-08-12T00:30:00.000Z', '2026-10-01T00:00:00.000Z', 3600, '2026-08-12T00:00:00.000Z', '2026-10-01T00:00:00.000Z'],
    ['a year: days', '2025-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', 86400, '2025-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'],
  ])('%s', (_label, from, to, slotSeconds, roundedFrom, roundedTo) => {
    const b = rangeBounds({ from, to }, now)

    expect(b).toEqual({ from: roundedFrom, to: roundedTo, slotSeconds })
    expect((Date.parse(b!.to) - Date.parse(b!.from)) / 1000 / slotSeconds).toBeLessThanOrEqual(1440)
  })

  it('stops an end ahead of now at now, and keeps the longest range within 400 days', () => {
    expect(rangeBounds({ from: '2026-10-29T10:00:00.000Z', to: '2027-01-01T00:00:00.000Z' }, now)?.to).toBe('2026-10-29T12:34:00.000Z')
    const b = rangeBounds({ from: '2025-09-24T06:00:00.000Z', to: '2026-10-28T23:00:00.000Z' }, now)!
    expect(Date.parse(b.to) - Date.parse(b.from)).toBeLessThanOrEqual(400 * 86400 * 1000)
  })

  it('refuses a range upside down, empty, in the future or longer than 400 days', () => {
    expect(rangeError({ from: '2026-10-28T00:00:00.000Z', to: '2026-10-27T00:00:00.000Z' }, now)).toBe('order')
    expect(rangeError({ from: '', to: '2026-10-27T00:00:00.000Z' }, now)).toBe('order')
    expect(rangeError({ from: '2026-11-01T00:00:00.000Z', to: '2026-11-02T00:00:00.000Z' }, now)).toBe('order')
    expect(rangeError({ from: '2025-01-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' }, now)).toBe('tooLong')
    expect(rangeBounds({ from: '2025-01-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' }, now)).toBeNull()
  })

  it('travels in the query string and back', () => {
    const range = { from: '2026-10-20T08:00:00.000Z', to: '2026-10-23T08:00:00.000Z' }

    expect(parseWindow(new URLSearchParams(windowQuery(range)), '24h')).toEqual(range)
    expect(parseWindow(new URLSearchParams(windowQuery('1y')), '24h')).toBe('1y')
    expect(parseWindow(new URLSearchParams('period=custom&from=x'), '24h')).toBeNull()
    expect(parseWindow(new URLSearchParams(''), '24h')).toBe('24h')
  })
})
