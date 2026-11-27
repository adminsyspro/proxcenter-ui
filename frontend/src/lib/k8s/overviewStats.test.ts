import { describe, it, expect } from 'vitest'
import { computeKindStat, healthRatioColor, OVERVIEW_KINDS } from './overviewStats'
import type { ResourceListItem } from './types'

function item(summary: Record<string, string>): ResourceListItem {
  return { kind: 'x', name: 'n', uid: 'u', createdAt: '', summary }
}

describe('overviewStats.computeKindStat', () => {
  it('counts ready nodes via summary.ready === "True"', () => {
    const items = [item({ ready: 'True' }), item({ ready: 'False' }), item({ ready: 'True' })]
    expect(computeKindStat('node', items)).toEqual({ total: 3, healthy: 2 })
  })

  it('counts active namespaces via summary.phase === "Active"', () => {
    const items = [item({ phase: 'Active' }), item({ phase: 'Terminating' })]
    expect(computeKindStat('namespace', items)).toEqual({ total: 2, healthy: 1 })
  })

  it('treats a fully-replicated deployment ratio as healthy', () => {
    const items = [item({ ready: '3/3' }), item({ ready: '0/1' }), item({ ready: '0/0' })]
    // 3/3 healthy, 0/1 not, 0/0 trivially complete → 2 healthy
    expect(computeKindStat('deployment', items)).toEqual({ total: 3, healthy: 2 })
  })

  it('treats a pod with all containers ready as healthy', () => {
    const items = [item({ ready: '1/1' }), item({ ready: '0/1' })]
    expect(computeKindStat('pod', items)).toEqual({ total: 2, healthy: 1 })
  })

  it('handles malformed or missing ratios as unhealthy', () => {
    const items = [item({}), item({ ready: 'bogus' }), item({ ready: '1' })]
    expect(computeKindStat('pod', items)).toEqual({ total: 3, healthy: 0 })
  })

  it('returns zeroes for an empty list', () => {
    expect(computeKindStat('pod', [])).toEqual({ total: 0, healthy: 0 })
  })
})

describe('overviewStats.healthRatioColor', () => {
  it('is grey when stat is null or empty', () => {
    expect(healthRatioColor(null)).toBe('#9e9e9e')
    expect(healthRatioColor({ total: 0, healthy: 0 })).toBe('#9e9e9e')
  })

  it('is green at >=80%, amber at >=50%, red below', () => {
    expect(healthRatioColor({ total: 10, healthy: 10 })).toBe('#4caf50')
    expect(healthRatioColor({ total: 10, healthy: 8 })).toBe('#4caf50')
    expect(healthRatioColor({ total: 10, healthy: 6 })).toBe('#ff9800')
    expect(healthRatioColor({ total: 10, healthy: 3 })).toBe('#f44336')
  })
})

describe('OVERVIEW_KINDS', () => {
  it('lists the four headline kinds', () => {
    expect([...OVERVIEW_KINDS]).toEqual(['node', 'namespace', 'deployment', 'pod'])
  })
})
