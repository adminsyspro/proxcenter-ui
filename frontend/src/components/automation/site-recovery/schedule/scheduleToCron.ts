import type { ScheduleSpec } from './types'

export function scheduleToCron(spec: ScheduleSpec, tz: string): string {
  let body: string
  switch (spec.mode) {
    case 'hourly':
      body = hourlyToCron(spec)
      break
    case 'daily':
      body = dailyToCron(spec)
      break
    case 'weekly':
      body = weeklyToCron(spec)
      break
    case 'monthly':
      body = monthlyToCron(spec)
      break
    default:
      throw new Error(`unknown schedule mode`)
  }
  return tz ? `CRON_TZ=${tz} ${body}` : body
}

function hourlyToCron(s: Extract<ScheduleSpec, { mode: 'hourly' }>): string {
  if (s.everyHours < 1 || s.everyHours > 24) {
    throw new Error(`everyHours must be in [1,24]`)
  }
  if (s.windowStart === undefined || s.windowEnd === undefined) {
    return `0 */${s.everyHours} * * *`
  }
  if (s.windowStart === s.windowEnd) {
    throw new Error(`window must span at least 1 hour`)
  }
  const hours: number[] = []
  let h = s.windowStart
  while (true) {
    hours.push(h)
    const next = (h + s.everyHours) % 24
    if (next === s.windowStart) break
    if (s.windowStart < s.windowEnd && (next < s.windowStart || next >= s.windowEnd)) break
    if (s.windowStart > s.windowEnd && next >= s.windowEnd && next < s.windowStart) break
    h = next
  }
  return `0 ${hours.join(',')} * * *`
}

function dailyToCron(s: Extract<ScheduleSpec, { mode: 'daily' }>): string {
  if (s.times.length === 0) throw new Error('daily: times must not be empty')
  if (s.weekdays.length === 0) throw new Error('daily: weekdays must not be empty')
  const parsed = s.times.map(parseHHMM).sort((a, b) => a.h - b.h || a.m - b.m)
  const firstMin = parsed[0].m
  if (parsed.some(p => p.m !== firstMin)) {
    throw new Error('daily: all times must share the same minute')
  }
  const hours = Array.from(new Set(parsed.map(p => p.h))).sort((a, b) => a - b).join(',')
  return `${firstMin} ${hours} * * ${weekdaysField(s.weekdays)}`
}

function weeklyToCron(s: Extract<ScheduleSpec, { mode: 'weekly' }>): string {
  if (s.weekdays.length === 0) throw new Error('weekly: weekdays must not be empty')
  const { h, m } = parseHHMM(s.time)
  return `${m} ${h} * * ${weekdaysField(s.weekdays)}`
}

function monthlyToCron(s: Extract<ScheduleSpec, { mode: 'monthly' }>): string {
  if (s.dayOfMonth < 1 || s.dayOfMonth > 28) {
    throw new Error('monthly: dayOfMonth must be in [1,28]')
  }
  const { h, m } = parseHHMM(s.time)
  return `${m} ${h} ${s.dayOfMonth} * *`
}

function parseHHMM(t: string): { h: number; m: number } {
  const parts = t.split(':')
  if (parts.length !== 2) throw new Error(`invalid time "${t}"`)
  const h = Number(parts[0])
  const m = Number(parts[1])
  if (!Number.isInteger(h) || h < 0 || h > 23) throw new Error(`invalid hour in "${t}"`)
  if (!Number.isInteger(m) || m < 0 || m > 59) throw new Error(`invalid minute in "${t}"`)
  return { h, m }
}

function weekdaysField(days: number[]): string {
  const d = [...days].sort((a, b) => a - b)
  if (d.length === 7) return '*'
  let contiguous = true
  for (let i = 1; i < d.length; i++) {
    if (d[i] !== d[i - 1] + 1) {
      contiguous = false
      break
    }
  }
  if (contiguous && d.length > 1) return `${d[0]}-${d[d.length - 1]}`
  return d.join(',')
}

export function deriveRPOSeconds(spec: ScheduleSpec): number {
  switch (spec.mode) {
    case 'hourly':
      return spec.everyHours * 3600
    case 'daily': {
      const hours = Array.from(new Set(spec.times.map(t => parseHHMM(t).h))).sort((a, b) => a - b)
      if (hours.length <= 1) return 86400
      let minGap = 24
      for (let i = 1; i < hours.length; i++) {
        minGap = Math.min(minGap, hours[i] - hours[i - 1])
      }
      minGap = Math.min(minGap, 24 - hours[hours.length - 1] + hours[0])
      return minGap * 3600
    }
    case 'weekly':
      return 7 * 86400
    case 'monthly':
      return 30 * 86400
  }
}
