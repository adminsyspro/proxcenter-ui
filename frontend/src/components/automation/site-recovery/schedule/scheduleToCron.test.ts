import { describe, it, expect } from 'vitest'
import { scheduleToCron } from './scheduleToCron'
import { ALLOWED_INTERVAL_MINUTES, type ScheduleSpec } from './types'

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

  it.each<[number, string]>([
    [1, '*/1 * * * *'],
    [2, '*/2 * * * *'],
    [3, '*/3 * * * *'],
    [4, '*/4 * * * *'],
    [5, '*/5 * * * *'],
    [6, '*/6 * * * *'],
    [10, '*/10 * * * *'],
    [12, '*/12 * * * *'],
    [15, '*/15 * * * *'],
    [20, '*/20 * * * *'],
    [30, '*/30 * * * *'],
    [60, '0 */1 * * *'],
    [120, '0 */2 * * *'],
    [180, '0 */3 * * *'],
    [240, '0 */4 * * *'],
    [360, '0 */6 * * *'],
    [480, '0 */8 * * *'],
    [720, '0 */12 * * *'],
    [1440, '0 0 * * *'],
  ])('maps a %i-minute interval to %s', (everyMinutes, expected) => {
    expect(ALLOWED_INTERVAL_MINUTES).toContain(everyMinutes)
    expect(scheduleToCron({ mode: 'interval', everyMinutes }, '')).toBe(expected)
  })

  it('rejects a sub-hourly interval that does not divide 60', () => {
    expect(() => scheduleToCron({ mode: 'interval', everyMinutes: 7 }, '')).toThrow()
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

// Pins the list so any change to it is a deliberate act, and points at the
// authoritative copy. The orchestrator rejects anything outside its own list
// (internal/replication/schedule_spec.go, AllowedIntervalMinutes), so a value
// added here alone produces a schedule the user cannot save.
describe('ALLOWED_INTERVAL_MINUTES stays in step with the orchestrator', () => {
  it('is exactly the set the orchestrator accepts', () => {
    expect([...ALLOWED_INTERVAL_MINUTES]).toEqual([
      1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30,
      60, 120, 180, 240, 360, 480, 720, 1440,
    ])
  })

  it('never offers a sub-hourly value that fails to divide 60', () => {
    for (const m of ALLOWED_INTERVAL_MINUTES) {
      if (m < 60) expect(60 % m).toBe(0)
      else expect(m % 60).toBe(0)
    }
  })
})
