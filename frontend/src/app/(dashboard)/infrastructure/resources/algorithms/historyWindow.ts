import type { ResourceTrend } from '../types'

export const HISTORY_WINDOW_DAYS = [90, 180, 365] as const

export type HistoryWindowDays = (typeof HISTORY_WINDOW_DAYS)[number]

export const DEFAULT_HISTORY_WINDOW_DAYS: HistoryWindowDays = 180

export type TrendsPeriod = { start: string | null; end: string | null; daysCount: number }

export function isHistoryWindowDays(value: unknown): value is HistoryWindowDays {
  return HISTORY_WINDOW_DAYS.includes(value as HistoryWindowDays)
}

function shiftIsoDay(isoDay: string, days: number): string {
  const date = new Date(`${isoDay}T00:00:00Z`)

  date.setUTCDate(date.getUTCDate() + days)

  return date.toISOString().slice(0, 10)
}

// The overview route returns one point per day, without gaps, up to a year.
// Keeping the last N points is therefore keeping the last N days of history.
export function sliceTrendsToWindow(
  trends: ResourceTrend[],
  period: TrendsPeriod | null,
  days: number,
): { trends: ResourceTrend[]; period: TrendsPeriod | null } {
  if (trends.length <= days) return { trends, period }

  const sliced = trends.slice(-days)

  if (!period?.end) return { trends: sliced, period }

  return {
    trends: sliced,
    period: { start: shiftIsoDay(period.end, -(sliced.length - 1)), end: period.end, daysCount: sliced.length },
  }
}
