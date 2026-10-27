// src/lib/availability/period.ts
//
// The periods of the availability page and the window each one queries. The
// end is rounded up to the next slot boundary so that two refreshes within a
// slot ask for the same slots: the timeline does not shift every 30 s.

export type Period = '1h' | '24h' | '7d' | '30d'

export const PERIODS: readonly Period[] = ['1h', '24h', '7d', '30d']

/** The period the page opens on, and the one an absent query value means. */
export const DEFAULT_PERIOD: Period = '24h'

const HOUR = 3600

const PERIOD_SPEC: Record<Period, { seconds: number; slotSeconds: number }> = {
  '1h': { seconds: HOUR, slotSeconds: 60 },
  '24h': { seconds: 24 * HOUR, slotSeconds: 60 },
  '7d': { seconds: 7 * 24 * HOUR, slotSeconds: 600 },
  '30d': { seconds: 30 * 24 * HOUR, slotSeconds: 3600 },
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
