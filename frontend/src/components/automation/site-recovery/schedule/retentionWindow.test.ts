import { describe, expect, it } from 'vitest'

import {
  RPO_SCHEDULE_DIVISOR,
  cadenceSeconds,
  formatWindow,
  retentionWindowSeconds,
} from './retentionWindow'
import { defaultTimezone, type ScheduleBuilderValue } from './types'

function value(partial: Partial<ScheduleBuilderValue>): ScheduleBuilderValue {
  return {
    mode: 'rpo',
    rpoTargetSeconds: 1800,
    scheduleSpec: null,
    timezone: defaultTimezone(),
    ...partial,
  }
}

describe('cadenceSeconds', () => {
  // The whole point of the caption: an RPO of 30 minutes does NOT replicate
  // every 30 minutes, the orchestrator schedules at a third of it for margin.
  // Users had no way to know, and discovered the retention depth they really
  // got only after the job had been running for days.
  it('reports the real cadence of an RPO target, not the target itself', () => {
    expect(cadenceSeconds(value({ mode: 'rpo', rpoTargetSeconds: 1800 }))).toBe(600)
    expect(RPO_SCHEDULE_DIVISOR).toBe(3)
  })

  it('never reports a cadence below one minute', () => {
    expect(cadenceSeconds(value({ mode: 'rpo', rpoTargetSeconds: 30 }))).toBe(60)
  })

  // rpoToCron divides by 180 in WHOLE minutes, so the cadence is always a
  // multiple of a minute (or of an hour past 60 minutes). A 5 minute RPO runs
  // `*/1`, i.e. every 60 seconds, not every 100: dividing the seconds by three
  // overstated the window by half at that setting.
  it('truncates to whole minutes exactly like the orchestrator cron', () => {
    expect(cadenceSeconds(value({ mode: 'rpo', rpoTargetSeconds: 300 }))).toBe(60)
    expect(cadenceSeconds(value({ mode: 'rpo', rpoTargetSeconds: 900 }))).toBe(300)
    expect(cadenceSeconds(value({ mode: 'rpo', rpoTargetSeconds: 3600 }))).toBe(1200)
    // 24 hours: 480 minutes, so `0 */8`, every 8 hours
    expect(cadenceSeconds(value({ mode: 'rpo', rpoTargetSeconds: 86400 }))).toBe(8 * 3600)
    // past 60 minutes the hour field truncates again: 100 minutes runs hourly
    expect(cadenceSeconds(value({ mode: 'rpo', rpoTargetSeconds: 100 * 180 }))).toBe(3600)
    // 1440 minutes or more between runs (a 3 day RPO) collapses to once a day
    expect(cadenceSeconds(value({ mode: 'rpo', rpoTargetSeconds: 1440 * 180 }))).toBe(86400)
    expect(cadenceSeconds(value({ mode: 'rpo', rpoTargetSeconds: 10 * 1440 * 180 }))).toBe(86400)
  })

  it('takes an interval spec at face value', () => {
    expect(
      cadenceSeconds(value({ mode: 'scheduled', scheduleSpec: { mode: 'interval', everyMinutes: 30 } }))
    ).toBe(1800)
  })

  it('reads an hourly spec', () => {
    expect(
      cadenceSeconds(value({ mode: 'scheduled', scheduleSpec: { mode: 'hourly', everyHours: 4 } }))
    ).toBe(4 * 3600)
  })

  // deriveRPOSeconds returns the NARROWEST gap, which is right for an RPO
  // promise. Retention depth is bounded by the WIDEST one, so this must not
  // reuse it: 09:00 and 17:00 leave a 16 hour gap overnight, not an 8 hour one.
  it('uses the widest gap of an irregular daily schedule, not the narrowest', () => {
    expect(
      cadenceSeconds(
        value({ mode: 'scheduled', scheduleSpec: { mode: 'daily', times: ['09:00', '17:00'], weekdays: [1] } })
      )
    ).toBe(16 * 3600)
  })

  it('treats a single daily time as a full day', () => {
    expect(
      cadenceSeconds(
        value({ mode: 'scheduled', scheduleSpec: { mode: 'daily', times: ['03:00'], weekdays: [1] } })
      )
    ).toBe(86400)
  })

  it('returns 0 when a scheduled value carries no spec, so the caller can skip the caption', () => {
    expect(cadenceSeconds(value({ mode: 'scheduled', scheduleSpec: null }))).toBe(0)
  })
})

describe('retentionWindowSeconds', () => {
  // N points spaced by the cadence span N-1 intervals, not N.
  it('spans one interval fewer than the number of points', () => {
    expect(retentionWindowSeconds(1800, 336)).toBe(335 * 1800)
    expect(retentionWindowSeconds(600, 2)).toBe(600)
  })

  it('is zero when a single point or none is kept, since one point spans nothing', () => {
    expect(retentionWindowSeconds(1800, 1)).toBe(0)
    expect(retentionWindowSeconds(1800, 0)).toBe(0)
  })

  it('is zero when the cadence is unknown', () => {
    expect(retentionWindowSeconds(0, 336)).toBe(0)
    expect(retentionWindowSeconds(-1, 336)).toBe(0)
  })

  // The case the customer asked for: 30 minutes and 7 days of restore points.
  it('confirms that 336 points at a true 30 minute cadence covers a week', () => {
    const week = 7 * 86400
    const covered = retentionWindowSeconds(1800, 336)

    expect(covered).toBeLessThanOrEqual(week)
    expect(covered).toBeGreaterThan(week - 2 * 1800)
  })
})

describe('formatWindow', () => {
  it('formats the units a reader cares about', () => {
    expect(formatWindow(45 * 60)).toBe('45m')
    expect(formatWindow(6 * 3600)).toBe('6h')
    expect(formatWindow(6 * 3600 + 30 * 60)).toBe('6h 30m')
    expect(formatWindow(3 * 86400)).toBe('3d')
    expect(formatWindow(3 * 86400 + 11 * 3600)).toBe('3d 11h')
  })

  it('returns an empty string for nothing, so the caller can drop the caption', () => {
    expect(formatWindow(0)).toBe('')
    expect(formatWindow(-5)).toBe('')
  })
})
