// src/lib/availability/period.ts
//
// The periods of the availability page and the window each one queries. The
// end is rounded up to the next slot boundary so that two refreshes within a
// slot ask for the same slots: the timeline does not shift every 30 s.

export type Period = '1h' | '24h' | '7d' | '30d' | '1y'

export const PERIODS: readonly Period[] = ['1h', '24h', '7d', '30d', '1y']

/** The period the page opens on, and the one an absent query value means. */
export const DEFAULT_PERIOD: Period = '24h'

const HOUR = 3600
const DAY = 24 * HOUR

const PERIOD_SPEC: Record<Period, { seconds: number; slotSeconds: number }> = {
  '1h': { seconds: HOUR, slotSeconds: 60 },
  '24h': { seconds: 24 * HOUR, slotSeconds: 60 },
  '7d': { seconds: 7 * 24 * HOUR, slotSeconds: 600 },
  '30d': { seconds: 30 * 24 * HOUR, slotSeconds: 3600 },
  '1y': { seconds: 365 * DAY, slotSeconds: DAY },
}

export function isPeriod(value: unknown): value is Period {
  return typeof value === 'string' && (PERIODS as readonly string[]).includes(value)
}

/** The period of a query string value, the fallback when absent, null when unknown. */
export function parsePeriod(value: string | null, fallback: Period): Period | null {
  if (value === null || value === '') return fallback
  return isPeriod(value) ? value : null
}

export function periodBounds(p: Period, now: Date): { from: string; to: string; slotSeconds: number } {
  const { seconds, slotSeconds } = PERIOD_SPEC[p]
  const slotMs = slotSeconds * 1000
  const to = Math.ceil(now.getTime() / slotMs) * slotMs
  const from = to - seconds * 1000
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString(), slotSeconds }
}

/** A range picked by hand, its bounds as ISO instants. */
export interface CustomRange {
  from: string
  to: string
}

/** What the overview shows: a period up to now, or a range picked by hand. */
export type PeriodWindow = Period | CustomRange

/** The longest range the orchestrator answers, in days. */
export const MAX_RANGE_DAYS = 400

// The orchestrator cuts a query into 1440 slots at most: a range takes the
// shortest slot that fits, the slots of the presets.
const MAX_SLOTS = 1440
const SLOT_STEPS = [60, 600, HOUR, DAY]

export type RangeError = 'order' | 'tooLong'

/** Why a range cannot be queried, null when it can. The end may lie ahead: it stops at now. */
export function rangeError(range: CustomRange, now: Date): RangeError | null {
  const from = Date.parse(range.from)
  const to = Math.min(Date.parse(range.to), now.getTime())

  if (Number.isNaN(from) || Number.isNaN(to) || from >= to) return 'order'
  if (to - from > MAX_RANGE_DAYS * DAY * 1000) return 'tooLong'

  return null
}

/** The slots of a range, its bounds rounded out to them; null when the range is not valid. */
export function rangeBounds(range: CustomRange, now: Date): { from: string; to: string; slotSeconds: number } | null {
  if (rangeError(range, now)) return null

  const end = Math.min(Date.parse(range.to), now.getTime())
  const length = (end - Date.parse(range.from)) / 1000
  const slotSeconds = SLOT_STEPS.find(s => Math.ceil(length / s) <= MAX_SLOTS) ?? DAY
  const slotMs = slotSeconds * 1000
  const to = Math.ceil(end / slotMs) * slotMs
  // Rounding out may add a slot at each end: the longest range still fits.
  const from = Math.max(Math.floor(Date.parse(range.from) / slotMs) * slotMs, to - MAX_RANGE_DAYS * DAY * 1000)

  return { from: new Date(from).toISOString(), to: new Date(to).toISOString(), slotSeconds }
}

/** The bounds of a period or of a range; null for a range that is not valid. */
export function windowBounds(w: PeriodWindow, now: Date): { from: string; to: string; slotSeconds: number } | null {
  return typeof w === 'string' ? periodBounds(w, now) : rangeBounds(w, now)
}

/** The window a query string asks: `period=custom&from=&to=`, a period, or the fallback; null when not valid. */
export function parseWindow(params: URLSearchParams, fallback: Period): PeriodWindow | null {
  if (params.get('period') !== 'custom') return parsePeriod(params.get('period'), fallback)

  const from = params.get('from')
  const to = params.get('to')

  return from && to ? { from, to } : null
}

/** The query string of a window, for the overview route. */
export function windowQuery(w: PeriodWindow): string {
  return typeof w === 'string'
    ? `period=${w}`
    : `period=custom&from=${encodeURIComponent(w.from)}&to=${encodeURIComponent(w.to)}`
}
