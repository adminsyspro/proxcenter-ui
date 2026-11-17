import { describe, expect, it } from 'vitest'

import { formatDurationMs, formatSchedule, loadSeverity, percent, relativeTime, sortTasks, taskState, usageSeverity } from './display'
import type { OrchestratorTask } from './types'

const task = (over: Partial<OrchestratorTask>): OrchestratorTask => ({
  name: 'task',
  schedule: '@every 1h',
  exclusive: false,
  running: false,
  runs: 0,
  failures: 0,
  last_duration_ms: 0,
  ...over
})

describe('taskState', () => {
  it('judges a task on its last run', () => {
    expect(taskState(task({}))).toBe('idle')
    expect(taskState(task({ runs: 3 }))).toBe('ok')
    // An old failure followed by a good run is not a failing task.
    expect(taskState(task({ runs: 3, failures: 1 }))).toBe('ok')
    expect(taskState(task({ runs: 3, failures: 1, last_error: 'boom' }))).toBe('failing')
    expect(taskState(task({ runs: 3, last_error: 'boom', running: true }))).toBe('running')
  })
})

describe('sortTasks', () => {
  it('puts the failing tasks first, then sorts by name, without touching its input', () => {
    const input = [task({ name: 'b' }), task({ name: 'c', last_error: 'x' }), task({ name: 'a' }), task({ name: 'aa', last_error: 'y' })]

    expect(sortTasks(input).map(t => t.name)).toEqual(['aa', 'c', 'a', 'b'])
    expect(input.map(t => t.name)).toEqual(['b', 'c', 'a', 'aa'])
  })
})

describe('formatSchedule', () => {
  it.each([
    ['@every 1h0m0s', '1h'],
    ['@every 1m0s', '1m'],
    ['@every 30s', '30s'],
    ['@every 10s', '10s'],
    ['@every 1m30s', '1m30s'],
    ['@every 1h30m0s', '1h30m'],
    ['@every 5m', '5m'],
    ['0 */5 * * * *', '0 */5 * * * *']
  ])('%s reads %s', (spec, expected) => {
    expect(formatSchedule(spec)).toBe(expected)
  })
})

describe('percent and severities', () => {
  it('bounds a ratio to 0..100', () => {
    expect(percent(5, 10)).toBe(50)
    expect(percent(15, 10)).toBe(100)
    expect(percent(-1, 10)).toBe(0)
    expect(percent(5, 0)).toBe(0)
  })

  it('warns from 75 % of a resource and alarms from 90 %', () => {
    expect(usageSeverity(74.9)).toBe('success')
    expect(usageSeverity(75)).toBe('warning')
    expect(usageSeverity(90)).toBe('error')
  })

  it('reads the load against the core count', () => {
    expect(loadSeverity(2, 8)).toBe('success')
    expect(loadSeverity(5.6, 8)).toBe('warning')
    expect(loadSeverity(8, 8)).toBe('error')
    expect(loadSeverity(8, 0)).toBe('success')
  })
})

describe('formatDurationMs', () => {
  it('picks the unit that fits', () => {
    expect(formatDurationMs(417)).toBe('417 ms')
    expect(formatDurationMs(2040)).toBe('2.0 s')
    expect(formatDurationMs(125_000)).toBe('2 min 5 s')
  })
})

describe('relativeTime', () => {
  const now = Date.parse('2026-11-17T08:00:00Z')

  it('words the distance in the viewer language', () => {
    expect(relativeTime('2026-11-17T07:57:00Z', now, 'en')).toBe('3 minutes ago')
    expect(relativeTime('2026-11-17T10:00:00Z', now, 'en')).toBe('in 2 hours')
    expect(relativeTime('2026-11-14T08:00:00Z', now, 'en')).toBe('3 days ago')
    expect(relativeTime('2026-11-17T07:59:50Z', now, 'en')).toBe('10 seconds ago')
    expect(relativeTime('2026-11-17T07:57:00Z', now, 'fr')).toBe('il y a 3 minutes')
  })

  it('is null without a usable date', () => {
    expect(relativeTime(null, now, 'en')).toBeNull()
    expect(relativeTime(undefined, now, 'en')).toBeNull()
    expect(relativeTime('not a date', now, 'en')).toBeNull()
  })
})
