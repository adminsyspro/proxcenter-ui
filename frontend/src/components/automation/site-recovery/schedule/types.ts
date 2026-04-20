export type ScheduleMode = 'rpo' | 'scheduled'

export type ScheduleSpec =
  | { mode: 'hourly'; everyHours: number; windowStart?: number; windowEnd?: number }
  | { mode: 'daily'; times: string[]; weekdays: number[] }
  | { mode: 'weekly'; weekdays: number[]; time: string }
  | { mode: 'monthly'; dayOfMonth: number; time: string }

export interface ScheduleBuilderValue {
  mode: ScheduleMode
  rpoTargetSeconds: number
  scheduleSpec: ScheduleSpec | null
  timezone: string
}

export function defaultSchedule(): ScheduleSpec {
  return { mode: 'daily', times: ['03:00'], weekdays: [0, 1, 2, 3, 4, 5, 6] }
}

export function defaultTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}
