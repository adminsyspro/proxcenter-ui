import { describe, expect, it } from 'vitest'

import { deployedCounts, lastCheckAt } from './summaryModel'
import { status, zone } from './microsegTestKit'

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
