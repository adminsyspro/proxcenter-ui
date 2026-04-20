import { describe, it, expect } from 'vitest'
import { scheduleToLabel } from './scheduleToLabel'
import type { ScheduleSpec } from './types'

const t = (key: string, params?: Record<string, string | number>): string => {
  const dict: Record<string, string> = {
    'siteRecovery.schedule.labels.dailyAllDays': 'Every day at {time}',
    'siteRecovery.schedule.labels.dailyWeekdays': 'Weekdays at {time}',
    'siteRecovery.schedule.labels.dailyCustom': '{days} at {time}',
    'siteRecovery.schedule.labels.weeklyOn': 'Every {day} at {time}',
    'siteRecovery.schedule.labels.monthlyOn': 'On day {day} of each month at {time}',
    'siteRecovery.schedule.labels.hourlyEvery': 'Every {n}h',
    'siteRecovery.schedule.labels.hourlyEveryWindow': 'Every {n}h between {start} and {end}',
    'siteRecovery.schedule.labels.andTz': '{label} ({tz})',
    'siteRecovery.schedule.days.mon': 'Mon',
    'siteRecovery.schedule.days.tue': 'Tue',
    'siteRecovery.schedule.days.wed': 'Wed',
    'siteRecovery.schedule.days.thu': 'Thu',
    'siteRecovery.schedule.days.fri': 'Fri',
    'siteRecovery.schedule.days.sat': 'Sat',
    'siteRecovery.schedule.days.sun': 'Sun',
  }
  let out = dict[key] ?? key
  if (params) for (const [k, v] of Object.entries(params)) out = out.replaceAll(`{${k}}`, String(v))
  return out
}

describe('scheduleToLabel', () => {
  it('daily all days', () => {
    const spec: ScheduleSpec = { mode: 'daily', times: ['03:00'], weekdays: [0, 1, 2, 3, 4, 5, 6] }
    expect(scheduleToLabel(spec, '', t)).toBe('Every day at 03:00')
  })

  it('daily weekdays', () => {
    const spec: ScheduleSpec = { mode: 'daily', times: ['03:00'], weekdays: [1, 2, 3, 4, 5] }
    expect(scheduleToLabel(spec, '', t)).toBe('Weekdays at 03:00')
  })

  it('weekly Sunday', () => {
    const spec: ScheduleSpec = { mode: 'weekly', weekdays: [0], time: '03:00' }
    expect(scheduleToLabel(spec, '', t)).toBe('Every Sun at 03:00')
  })

  it('monthly', () => {
    const spec: ScheduleSpec = { mode: 'monthly', dayOfMonth: 15, time: '03:00' }
    expect(scheduleToLabel(spec, '', t)).toBe('On day 15 of each month at 03:00')
  })

  it('hourly with window', () => {
    const spec: ScheduleSpec = { mode: 'hourly', everyHours: 2, windowStart: 20, windowEnd: 6 }
    expect(scheduleToLabel(spec, '', t)).toBe('Every 2h between 20:00 and 06:00')
  })

  it('appends timezone', () => {
    const spec: ScheduleSpec = { mode: 'daily', times: ['03:00'], weekdays: [0, 1, 2, 3, 4, 5, 6] }
    expect(scheduleToLabel(spec, 'Europe/Paris', t)).toBe('Every day at 03:00 (Europe/Paris)')
  })
})
