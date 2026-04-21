import type { ScheduleSpec } from './types'

type TFn = (key: string, params?: Record<string, string | number>) => string

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

export function scheduleToLabel(spec: ScheduleSpec, tz: string, t: TFn): string {
  const base = baseLabel(spec, t)
  if (!tz) return base
  return t('siteRecovery.schedule.labels.andTz', { label: base, tz })
}

function baseLabel(spec: ScheduleSpec, t: TFn): string {
  switch (spec.mode) {
    case 'hourly': {
      if (spec.windowStart === undefined || spec.windowEnd === undefined) {
        return t('siteRecovery.schedule.labels.hourlyEvery', { n: spec.everyHours })
      }
      return t('siteRecovery.schedule.labels.hourlyEveryWindow', {
        n: spec.everyHours,
        start: pad(spec.windowStart) + ':00',
        end: pad(spec.windowEnd) + ':00',
      })
    }
    case 'daily': {
      const time = spec.times.slice().sort((a, b) => a.localeCompare(b)).join(', ')
      if (spec.weekdays.length === 7) {
        return t('siteRecovery.schedule.labels.dailyAllDays', { time })
      }
      const isWeekdays = spec.weekdays.length === 5 &&
        [1, 2, 3, 4, 5].every(d => spec.weekdays.includes(d))
      if (isWeekdays) {
        return t('siteRecovery.schedule.labels.dailyWeekdays', { time })
      }
      const days = spec.weekdays.map(d => t(`siteRecovery.schedule.days.${DAY_KEYS[d]}`)).join(', ')
      return t('siteRecovery.schedule.labels.dailyCustom', { days, time })
    }
    case 'weekly': {
      const day = spec.weekdays.map(d => t(`siteRecovery.schedule.days.${DAY_KEYS[d]}`)).join(', ')
      return t('siteRecovery.schedule.labels.weeklyOn', { day, time: spec.time })
    }
    case 'monthly':
      return t('siteRecovery.schedule.labels.monthlyOn', { day: spec.dayOfMonth, time: spec.time })
  }
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}
