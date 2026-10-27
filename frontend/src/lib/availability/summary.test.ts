import { describe, expect, it } from 'vitest'

import { summarize } from './summary'
import type { Result } from './types'

function result(up: number, down: number, unobserved: number, maintenance = 0): Result {
  return {
    ref: { connection_id: 'c1', kind: 'node', node: 'pve1' },
    up_seconds: up,
    down_seconds: down,
    maintenance_seconds: maintenance,
    unobserved_seconds: unobserved,
    availability: null,
    coverage: null,
    slots: [],
    incidents: [],
  }
}

describe('summarize', () => {
  it('adds the durations and applies the orchestrator formulas', () => {
    const s = summarize([result(3000, 600, 0, 120), result(5400, 0, 600)])
    expect(s.up_seconds).toBe(8400)
    expect(s.down_seconds).toBe(600)
    expect(s.unobserved_seconds).toBe(600)
    // availability = up / (up + down); coverage = (up + down) / (up + down + unobserved)
    expect(s.availability).toBeCloseTo((8400 / 9000) * 100, 10)
    expect(s.coverage).toBeCloseTo((9000 / 9600) * 100, 10)
    expect(s.below_target).toBe(0)
    expect(s.budget).toBeNull()
  })

  it('leaves maintenance out of both denominators', () => {
    const s = summarize([result(3600, 0, 0, 7200)])
    expect(s.availability).toBe(100)
    expect(s.coverage).toBe(100)
  })

  it('answers null, never 0, when a denominator is zero', () => {
    expect(summarize([]).availability).toBeNull()
    expect(summarize([]).coverage).toBeNull()
    const unobservedOnly = summarize([result(0, 0, 3600)])
    expect(unobservedOnly.availability).toBeNull()
    expect(unobservedOnly.coverage).toBe(0)
  })
})
