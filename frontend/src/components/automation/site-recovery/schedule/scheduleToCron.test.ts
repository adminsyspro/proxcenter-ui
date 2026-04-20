import { describe, it, expect } from 'vitest'
import { scheduleToCron } from './scheduleToCron'
import type { ScheduleSpec } from './types'

describe('scheduleToCron', () => {
  it.each<[ScheduleSpec, string, string]>([
    [{ mode: 'hourly', everyHours: 2 }, '', '0 */2 * * *'],
    [{ mode: 'hourly', everyHours: 2, windowStart: 20, windowEnd: 6 }, '', '0 20,22,0,2,4 * * *'],
    [{ mode: 'daily', times: ['03:00', '15:00'], weekdays: [1, 2, 3, 4, 5] }, '', '0 3,15 * * 1-5'],
    [{ mode: 'daily', times: ['03:00'], weekdays: [0, 1, 2, 3, 4, 5, 6] }, '', '0 3 * * *'],
    [{ mode: 'weekly', weekdays: [0], time: '03:00' }, '', '0 3 * * 0'],
    [{ mode: 'monthly', dayOfMonth: 15, time: '03:00' }, '', '0 3 15 * *'],
    [{ mode: 'daily', times: ['03:00'], weekdays: [0, 1, 2, 3, 4, 5, 6] }, 'Europe/Paris', 'CRON_TZ=Europe/Paris 0 3 * * *'],
  ])('%j / tz=%s → %s', (spec, tz, expected) => {
    expect(scheduleToCron(spec, tz)).toBe(expected)
  })

  it('throws on empty weekdays', () => {
    expect(() => scheduleToCron({ mode: 'daily', times: ['03:00'], weekdays: [] }, '')).toThrow()
  })

  it('throws on empty times', () => {
    expect(() => scheduleToCron({ mode: 'daily', times: [], weekdays: [1] }, '')).toThrow()
  })

  it('throws on dayOfMonth out of range', () => {
    expect(() => scheduleToCron({ mode: 'monthly', dayOfMonth: 29, time: '03:00' }, '')).toThrow()
  })
})
