export type ScheduleMode = 'rpo' | 'scheduled'

// Cadences the interval schedule mode accepts.
//
// Below 60, only divisors of 60 produce a REGULAR gap: `*/7` in a cron minute
// field fires at 0,7,...,56 and then again at the next hour's 0, a 4 minute
// gap, so the schedule would not honour the interval it claims. The same
// reasoning applies to hours against 24.
//
// ⚠️ The orchestrator holds the authoritative copy in
// internal/replication/schedule_spec.go (AllowedIntervalMinutes) and rejects
// anything else. These two lists must stay identical: a value offered here and
// refused there is a job the user cannot save.
export const ALLOWED_INTERVAL_MINUTES = [
  1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30,
  60, 120, 180, 240, 360, 480, 720, 1440,
] as const

export type ScheduleSpec =
  | { mode: 'interval'; everyMinutes: number }
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
