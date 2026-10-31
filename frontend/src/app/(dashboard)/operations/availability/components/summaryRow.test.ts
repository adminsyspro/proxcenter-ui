import { describe, expect, it } from 'vitest'

import { makeResult } from './fixtures'
import { mergeSlots, summaryResult } from './summaryRow'

describe('mergeSlots', () => {
  it('keeps the worst state of each slot, absent only where every row is', () => {
    const merged = mergeSlots([
      makeResult('a', ['absent', 'up', 'up', 'unobserved', 'up']),
      makeResult('b', ['absent', 'up', 'maintenance', 'up', 'down']),
    ])

    expect(merged.map(s => s.state)).toEqual(['absent', 'up', 'maintenance', 'unobserved', 'down'])
  })

  it('orders the slots of rows that start apart', () => {
    const late = makeResult('b', ['down', 'down'])

    late.slots = late.slots.map(s => ({ ...s, start: new Date(Date.parse(s.start) + 60_000).toISOString() }))

    expect(mergeSlots([late, makeResult('a', ['up', 'up'])]).map(s => s.state)).toEqual(['up', 'down', 'down'])
  })

  it('is empty without rows', () => {
    expect(mergeSlots([])).toEqual([])
  })
})

describe('summaryResult', () => {
  it('counts each run of down slots once, the last one ending at the window end', () => {
    const result = summaryResult({
      id: 'c1',
      name: 'Paris',
      cluster: makeResult('cluster', ['up', 'up', 'up', 'up', 'down']),
      nodes: [makeResult('pve1', ['down', 'down', 'up', 'up', 'up'])],
      summary: { up_seconds: 1, down_seconds: 2, unobserved_seconds: 3, availability: 60, coverage: 100, below_target: 0, budget: null },
    }, '2026-10-27T10:05:00.000Z')

    expect(result.ref).toEqual({ connection_id: 'c1', kind: 'cluster' })
    expect(result.availability).toBe(60)
    expect(result.incidents).toEqual([
      { from: '2026-10-27T10:00:00.000Z', to: '2026-10-27T10:02:00.000Z', state: 'down' },
      { from: '2026-10-27T10:04:00.000Z', to: '2026-10-27T10:05:00.000Z', state: 'down' },
    ])
  })
})
