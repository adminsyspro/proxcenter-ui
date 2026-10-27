import { afterEach, describe, expect, it, vi } from 'vitest'

import { formatTime, mapTimeRange, sliceToRange } from './timeRangeUtils'

afterEach(() => vi.useRealTimers())

describe('mapTimeRange', () => {
  it.each([
    ['hour', { rrdTimeframe: 'hour', trendsTimeframe: 'hour', days: 1, hours: 1, label: '1h' }],
    ['6h', { rrdTimeframe: 'day', trendsTimeframe: 'day', days: 1, hours: 6, label: '6h' }],
    ['day', { rrdTimeframe: 'day', trendsTimeframe: 'day', days: 1, hours: 24, label: '24h' }],
    ['week', { rrdTimeframe: 'week', trendsTimeframe: 'week', days: 7, hours: 168, label: '7d' }],
    ['month', { rrdTimeframe: 'month', trendsTimeframe: 'month', days: 30, hours: 720, label: '30d' }]
  ])('maps %s', (range, expected) => {
    expect(mapTimeRange(range)).toEqual(expected)
  })

  it.each([undefined, null, '', 'year', 'toString', '__proto__'])('falls back to the hour for %s', range => {
    expect(mapTimeRange(range)).toEqual(mapTimeRange('hour'))
  })
})

describe('formatTime', () => {
  const at = (time: number | string) => [{ payload: { time } }]

  it('formats unix seconds and milliseconds as dd/mm hh:mm', () => {
    const ms = new Date(2026, 2, 4, 14, 30).getTime()
    expect(formatTime(at(ms))).toBe('04/03 14:30')
    expect(formatTime(at(ms / 1000))).toBe('04/03 14:30')
  })

  it('reads the `t` field when `time` is absent and accepts date strings', () => {
    expect(formatTime([{ payload: { t: new Date(2026, 0, 9, 8, 5).toISOString() } }])).toBe('09/01 08:05')
  })

  it('returns an unparsable value unchanged and null without a value', () => {
    expect(formatTime(at('not a date'))).toBe('not a date')
    expect(formatTime([])).toBeNull()
    expect(formatTime(undefined)).toBeNull()
    expect(formatTime([{}])).toBeNull()
  })
})

describe('sliceToRange', () => {
  it('returns empty or missing data unchanged', () => {
    expect(sliceToRange(undefined, '6h')).toBeUndefined()
    expect(sliceToRange(null, '6h')).toBeNull()
    const empty: { time?: number }[] = []
    expect(sliceToRange(empty, '6h')).toBe(empty)
  })

  it('only slices the 6h range', () => {
    const data = [{ time: 1 }, { time: 2 }]
    expect(sliceToRange(data, 'day')).toBe(data)
  })

  it('keeps the last six hours, in seconds or milliseconds, and points without a time', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-26T12:00:00Z'))
    const now = Date.now() / 1000
    const data = [
      { time: now - 7 * 3600 },
      { time: now - 5 * 3600 },
      { t: (now - 3600) * 1000 },
      { t: (now - 8 * 3600) * 1000 },
      { time: 0 }
    ]
    expect(sliceToRange(data, '6h')).toEqual([data[1], data[2], data[4]])
  })
})
