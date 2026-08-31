import { type ScheduleBuilderValue, type ScheduleSpec } from './types'

/**
 * How much faster than the stated RPO target the orchestrator schedules a job.
 *
 * ⚠️ Mirrors rpoToCron in internal/replication/schedule_spec.go, which divides
 * the RPO target by 180 seconds to get a cron interval in minutes, i.e. runs at
 * a third of the target for margin. It is the reason a job labelled "30 minutes"
 * replicates every ten, and the reason the user has to be told the difference
 * rather than discover it in production.
 */
export const RPO_SCHEDULE_DIVISOR = 3

/**
 * The cadence rpoToCron really produces, in seconds.
 *
 * Step for step the same arithmetic as the Go function, because cron only
 * takes whole minutes and whole hours: `rpoSec / 180` truncated to minutes
 * (floor 1), then, at 60 minutes and beyond, truncated again to hours, and
 * once a day past 24 hours. Dividing the seconds by three instead gave 100 s
 * for a 5 minute RPO where the cron fires every 60, and the caption overstated
 * the window by half.
 */
function rpoCadenceSeconds(rpoTargetSeconds: number): number {
  const intervalMin = Math.floor(rpoTargetSeconds / (RPO_SCHEDULE_DIVISOR * 60))
  if (intervalMin < 1) return 60
  if (intervalMin < 60) return intervalMin * 60

  const hours = Math.floor(intervalMin / 60)
  if (hours < 24) return hours * 3600

  return 86400
}

/**
 * The WIDEST gap a schedule produces, in seconds.
 *
 * Deliberately not deriveRPOSeconds(), which returns the narrowest gap. Both are
 * right for their own question: the narrowest bounds the data loss an RPO
 * promises, the widest bounds how far back a fixed number of restore points
 * reaches. Using the narrowest here would overstate the retention depth of any
 * irregular schedule.
 */
export function cadenceSeconds(value: ScheduleBuilderValue): number {
  if (value.mode === 'rpo') {
    return rpoCadenceSeconds(value.rpoTargetSeconds)
  }
  if (!value.scheduleSpec) return 0

  return widestGapSeconds(value.scheduleSpec)
}

function widestGapSeconds(spec: ScheduleSpec): number {
  switch (spec.mode) {
    case 'interval':
      return spec.everyMinutes * 60
    case 'hourly':
      return spec.everyHours * 3600
    case 'daily': {
      const hours = Array.from(new Set(spec.times.map(t => Number.parseInt(t.slice(0, 2), 10)))).sort(
        (a, b) => a - b
      )
      if (hours.length <= 1) return 86400
      let widest = 0
      for (let i = 1; i < hours.length; i++) {
        widest = Math.max(widest, hours[i] - hours[i - 1])
      }
      widest = Math.max(widest, 24 - hours[hours.length - 1] + hours[0])

      return widest * 3600
    }
    case 'weekly':
      return 7 * 86400
    case 'monthly':
      return 30 * 86400
  }
}

/** How far back `keep` restore points reach at a given cadence. */
export function retentionWindowSeconds(cadenceSec: number, keep: number): number {
  if (cadenceSec <= 0 || keep <= 1) return 0

  // N points spaced by the cadence span N-1 intervals.
  return (keep - 1) * cadenceSec
}

/**
 * Compact, non-technical duration: "45 minutes", "6 hours", "3 days 11 hours".
 * Returns an empty string for zero, so callers can skip the caption entirely.
 */
export function formatWindow(seconds: number): string {
  if (seconds <= 0) return ''

  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)

  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`

  return `${minutes}m`
}
