import { describe, expect, it } from 'vitest'

import { formatWhen, lastCheckAt, stillPaused } from './summaryModel'
import { status } from './microsegTestKit'

describe('lastCheckAt', () => {
  const run = (started_at: string) => ({ started_at, status: 'done' as const, api_calls: 1, writes: 0 })
  const withRuns = (last_runs: Record<string, ReturnType<typeof run>>) =>
    status({ engine: { paused_until: null, held: false, last_log: null, last_runs } })

  it('is the newest run of the engine, whatever its kind', () => {
    expect(lastCheckAt(withRuns({
      light: run('2026-11-02T10:00:00Z'), full: run('2026-11-02T10:05:00Z'), ips: run('2026-11-02T09:00:00Z'),
    }))?.toISOString()).toBe('2026-11-02T10:05:00.000Z')
  })

  it('ignores what an admin started (plan, apply, remove, restore)', () => {
    expect(lastCheckAt(withRuns({
      light: run('2026-11-02T10:00:00Z'), apply: run('2026-11-02T11:00:00Z'), plan: run('2026-11-02T12:00:00Z'),
      remove: run('2026-11-02T13:00:00Z'), restore: run('2026-11-02T14:00:00Z'),
    }))?.toISOString()).toBe('2026-11-02T10:00:00.000Z')
  })

  it('is null when the engine has not run yet or the dates are unreadable', () => {
    expect(lastCheckAt(withRuns({}))).toBeNull()
    expect(lastCheckAt(withRuns({ full: run('not a date') }))).toBeNull()
    expect(lastCheckAt(withRuns({ apply: run('2026-11-02T11:00:00Z') }))).toBeNull()
  })
})

describe('stillPaused', () => {
  it('is true while the end of the pause is ahead', () => {
    expect(stillPaused(new Date(Date.now() + 60_000).toISOString())).toBe(true)
  })

  it('is false once the end is past, when there is no pause, or when the date is unreadable', () => {
    expect(stillPaused(new Date(Date.now() - 60_000).toISOString())).toBe(false)
    expect(stillPaused(null)).toBe(false)
    expect(stillPaused(undefined)).toBe(false)
    expect(stillPaused('')).toBe(false)
  })
})

describe('formatWhen', () => {
  const format = { dateTime: (d: Date) => `at ${d.toISOString()}` } as never

  it('formats a date', () => {
    expect(formatWhen(format, '2026-11-02T10:00:00Z')).toBe('at 2026-11-02T10:00:00.000Z')
  })

  it('returns the raw text when it is not a date', () => {
    expect(formatWhen(format, 'soon')).toBe('soon')
  })
})
