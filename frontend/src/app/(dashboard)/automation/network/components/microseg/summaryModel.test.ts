import { describe, expect, it } from 'vitest'

import { adminRunsMark, deployedCounts, formatWhen, lastCheckAt, policyNotSetUp, stillPaused } from './summaryModel'
import { policy, status, zone } from './microsegTestKit'

describe('deployedCounts', () => {
  it('counts the enforced and the observing zones of a snapshot, not the disabled ones', () => {
    expect(deployedCounts({
      tag_prefix: 'zone-', flows: [],
      zones: [zone('a', { state: 'enforce' }), zone('b', { state: 'observe' }), zone('c', { state: 'observe' }), zone('d', { state: 'disabled' })],
    })).toEqual({ enforced: 1, observing: 2 })
  })

  it('reads zeros for an empty snapshot', () => {
    expect(deployedCounts({ tag_prefix: 'zone-', flows: [], zones: [] })).toEqual({ enforced: 0, observing: 0 })
  })
})

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

describe('adminRunsMark', () => {
  const run = (started_at: string) => ({ started_at, status: 'done' as const, api_calls: 1, writes: 1 })

  it('moves with a new apply, remove or restore, or the stop, and not with the engine own runs', () => {
    const base = status()
    const mark = adminRunsMark(base)

    expect(adminRunsMark(status({ engine: { ...base.engine, last_runs: { full: run('2026-11-03T10:00:00Z') } } }))).toBe(mark)
    expect(adminRunsMark(status({ engine: { ...base.engine, last_runs: { apply: run('2026-11-03T10:00:00Z') } } }))).not.toBe(mark)
    expect(adminRunsMark(status({ engine: { ...base.engine, last_runs: { restore: run('2026-11-03T10:00:00Z') } } }))).not.toBe(mark)
    expect(adminRunsMark(status({ emergency_stop: true }))).not.toBe(mark)
  })
})

describe('policyNotSetUp', () => {
  it('is the empty draft of a connection nobody configured, never a deployed or edited one', () => {
    expect(policyNotSetUp(policy({ version: 0, zones: [], last_revision: null }))).toBe(true)
    expect(policyNotSetUp(policy({ version: 4, zones: [], last_revision: null }))).toBe(false)
    expect(policyNotSetUp(policy({ version: 0, zones: [zone('a')], last_revision: null }))).toBe(false)
    expect(policyNotSetUp(policy({ version: 0, zones: [], last_revision: { id: 'r', version: 1, author: 'me', created_at: '2026-11-01T00:00:00Z' } }))).toBe(false)
  })
})
