import { describe, expect, it } from 'vitest'

import type { AvailabilityState, Slot } from '@/lib/availability/types'

import { maxBarsFor, statusBars } from './statusBars'

const T0 = Date.UTC(2026, 9, 27, 0, 0, 0)

/** `count` slots `seconds` apart, all up but the states given by index. */
const slotsOf = (count: number, seconds: number, states: Record<number, AvailabilityState> = {}): Slot[] =>
  Array.from({ length: count }, (_, i) => ({ start: new Date(T0 + i * seconds * 1000).toISOString(), state: states[i] ?? 'up' }))

describe('statusBars', () => {
  it.each([
    ['1 h of minutes', 60, 60, 60],
    ['24 h of minutes', 1440, 60, 72],
    ['7 d of 10 minutes', 1008, 600, 84],
    ['30 d of hours', 720, 3600, 90],
  ])('groups %s into %i bars', (_label, count, seconds, bars) => {
    expect(statusBars(slotsOf(count, seconds))).toHaveLength(bars)
  })

  it.each([
    ['24 h', 1440, 60, 144],
    ['7 d', 1008, 600, 168],
    ['30 d', 720, 3600, 120],
    ['1 h', 60, 60, 60],
  ])('fits %s into %i bars on a row 1 700 px wide', (_label, count, seconds, bars) => {
    expect(statusBars(slotsOf(count, seconds), undefined, maxBarsFor(1700))).toHaveLength(bars)
  })

  it('keeps 30 bars at least on a narrow row and 90 while the width is unknown', () => {
    expect(maxBarsFor(200)).toBe(30)
    expect(maxBarsFor(0)).toBe(90)
    expect(statusBars(slotsOf(1440, 60), undefined, maxBarsFor(343))).toHaveLength(24)
  })

  it('reds the whole bar for a single down minute and rates it on what was seen', () => {
    const [first, second] = statusBars(slotsOf(1440, 60, { 31: 'down', 32: 'unobserved' }))

    expect(first).toMatchObject({ state: 'up', downStarts: [], availability: 100 })
    expect(second.state).toBe('down')
    expect(second.first).toBe(20)
    expect(second.downStarts).toEqual([31])
    expect(second.availability).toBeCloseTo((18 / 19) * 100)
  })

  it('keeps each outage of a bar, a run cut by the bar start included', () => {
    const [first, second] = statusBars(slotsOf(1440, 60, { 2: 'down', 3: 'down', 7: 'down', 19: 'down', 20: 'down' }))

    expect(first.downStarts).toEqual([2, 7, 19])
    expect(second.downStarts).toEqual([20])
  })

  it('puts maintenance before up and leaves a bar never seen unmeasured', () => {
    const bars = statusBars(slotsOf(3, 60, { 0: 'maintenance', 2: 'absent' }))

    expect(bars.map(b => b.state)).toEqual(['maintenance', 'up', 'absent'])
    expect(bars[0].availability).toBeNull()
    expect(bars[2].availability).toBeNull()
  })

  it('bounds each bar by its slots and the last one by the end of the window', () => {
    const bars = statusBars(slotsOf(1440, 60), '2026-10-27T23:45:00.000Z')

    expect(bars[0]).toMatchObject({ start: '2026-10-27T00:00:00.000Z', end: '2026-10-27T00:20:00.000Z' })
    expect(bars[71].end).toBe('2026-10-27T23:45:00.000Z')
  })

  it('has no bar without a slot', () => {
    expect(statusBars([])).toEqual([])
  })
})
