import { describe, it, expect, afterEach } from 'vitest'

import { sessionDurations, isPastAbsoluteCap } from './durations'

const ENV = { idle: process.env.SESSION_IDLE_TIMEOUT, abs: process.env.SESSION_ABSOLUTE_TIMEOUT }

afterEach(() => {
  if (ENV.idle === undefined) delete process.env.SESSION_IDLE_TIMEOUT
  else process.env.SESSION_IDLE_TIMEOUT = ENV.idle
  if (ENV.abs === undefined) delete process.env.SESSION_ABSOLUTE_TIMEOUT
  else process.env.SESSION_ABSOLUTE_TIMEOUT = ENV.abs
})

describe('sessionDurations', () => {
  it('defaults to 12h idle and 7d absolute', () => {
    delete process.env.SESSION_IDLE_TIMEOUT
    delete process.env.SESSION_ABSOLUTE_TIMEOUT
    expect(sessionDurations()).toEqual({ idleMs: 12 * 3600_000, absoluteMs: 7 * 86400_000 })
  })

  it('reads seconds from the environment', () => {
    process.env.SESSION_IDLE_TIMEOUT = '3600'
    process.env.SESSION_ABSOLUTE_TIMEOUT = '86400'
    expect(sessionDurations()).toEqual({ idleMs: 3600_000, absoluteMs: 86400_000 })
  })

  it('ignores non-numeric and non-positive values rather than disabling the cap', () => {
    process.env.SESSION_IDLE_TIMEOUT = 'nonsense'
    process.env.SESSION_ABSOLUTE_TIMEOUT = '0'
    expect(sessionDurations()).toEqual({ idleMs: 12 * 3600_000, absoluteMs: 7 * 86400_000 })
  })
})

describe('isPastAbsoluteCap: the one shared rule for both sides of the Edge boundary', () => {
  const DURATIONS = { idleMs: 12 * 3600_000, absoluteMs: 7 * 86400_000 }
  const NOW = Date.parse('2026-08-03T12:00:00.000Z')

  it('is not past the cap while still below it', () => {
    const startMs = NOW - (DURATIONS.absoluteMs - 1)
    expect(isPastAbsoluteCap(startMs, NOW, DURATIONS)).toBe(false)
  })

  it('is not past the cap exactly at it (strictly greater-than, not gte)', () => {
    const startMs = NOW - DURATIONS.absoluteMs
    expect(isPastAbsoluteCap(startMs, NOW, DURATIONS)).toBe(false)
  })

  it('is past the cap one millisecond after it', () => {
    const startMs = NOW - DURATIONS.absoluteMs - 1
    expect(isPastAbsoluteCap(startMs, NOW, DURATIONS)).toBe(true)
  })
})
