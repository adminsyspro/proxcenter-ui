import { describe, it, expect } from 'vitest'
import {
  TOP_RESTARTS_LIMIT, WARNINGS_LIMIT, NODE_BARS_LIMIT,
  podPhaseBreakdown, podPhaseColor, parseRestarts, podsPerNode, topRestarts, recentWarnings, relativeAge,
} from './overviewCharts'
import type { ResourceListItem, EventItem } from './types'

function pod(summary: Record<string, string>, name = 'p', namespace = 'ns'): ResourceListItem {
  return { kind: 'pod', name, namespace, uid: name, createdAt: '', summary }
}
function ev(over: Partial<EventItem>): EventItem {
  return { type: 'Warning', reason: 'R', message: 'm', object: 'o', count: 1, firstSeen: '', lastSeen: '', ...over }
}

describe('constants', () => {
  it('are the agreed values', () => {
    expect([TOP_RESTARTS_LIMIT, WARNINGS_LIMIT, NODE_BARS_LIMIT]).toEqual([8, 10, 12])
  })
})

describe('podPhaseColor', () => {
  it('maps known phases to their dot colour', () => {
    expect(podPhaseColor('Running')).toBe('#4caf50')
    expect(podPhaseColor('Succeeded')).toBe('#26a69a')
    expect(podPhaseColor('Pending')).toBe('#ff9800')
    expect(podPhaseColor('Failed')).toBe('#f44336')
    expect(podPhaseColor('Unknown')).toBe('#9e9e9e')
  })
  it('falls back to grey for missing/unrecognised phases', () => {
    expect(podPhaseColor(undefined)).toBe('#9e9e9e')
    expect(podPhaseColor('Weird')).toBe('#9e9e9e')
  })
})

describe('podPhaseBreakdown', () => {
  it('groups by phase in canonical order, only non-zero, with colours', () => {
    const out = podPhaseBreakdown([
      pod({ phase: 'Running' }), pod({ phase: 'Running' }), pod({ phase: 'Failed' }),
    ])
    expect(out).toEqual([
      { phase: 'Running', count: 2, color: '#4caf50' },
      { phase: 'Failed', count: 1, color: '#f44336' },
    ])
  })
  it('defaults a missing phase to Unknown', () => {
    expect(podPhaseBreakdown([pod({})])).toEqual([{ phase: 'Unknown', count: 1, color: '#9e9e9e' }])
  })
})

describe('parseRestarts', () => {
  it('parses, and floors missing/non-numeric/negative to 0', () => {
    expect(parseRestarts('5')).toBe(5)
    expect(parseRestarts(undefined)).toBe(0)
    expect(parseRestarts('abc')).toBe(0)
    expect(parseRestarts('-3')).toBe(0)
  })
})

describe('podsPerNode', () => {
  it('zero-fills known nodes, counts pods, sorts desc, appends Unscheduled', () => {
    const out = podsPerNode(
      [pod({ node: 'n1' }), pod({ node: 'n1' }), pod({ node: 'n2' }), pod({})],
      ['n1', 'n2', 'n3'],
    )
    expect(out).toEqual([
      { node: 'n1', count: 2 },
      { node: 'n2', count: 1 },
      { node: 'n3', count: 0 },
      { node: '', count: 1 }, // unscheduled
    ])
  })
  it('omits the Unscheduled bucket when all pods are scheduled', () => {
    const out = podsPerNode([pod({ node: 'n1' })], ['n1'])
    expect(out).toEqual([{ node: 'n1', count: 1 }])
  })
  it('folds a pod on a node absent from the canonical list into Unscheduled (no phantom bar)', () => {
    const out = podsPerNode([pod({ node: 'n1' }), pod({ node: 'ghost' })], ['n1'])
    expect(out).toEqual([
      { node: 'n1', count: 1 },
      { node: '', count: 1 }, // 'ghost' is not in nodeNames → unscheduled, not its own bar
    ])
  })
})

describe('topRestarts', () => {
  it('filters zero-restart pods, sorts desc, caps, and tones by readiness', () => {
    const out = topRestarts([
      pod({ restarts: '0', ready: '1/1', phase: 'Running' }, 'a'),
      pod({ restarts: '5', ready: '0/1', phase: 'Running' }, 'b'), // not ready -> red
      pod({ restarts: '2', ready: '1/1', phase: 'Running' }, 'c'), // ready+restarts -> amber
    ])
    expect(out).toEqual([
      { name: 'b', namespace: 'ns', restarts: 5, tone: 'red' },
      { name: 'c', namespace: 'ns', restarts: 2, tone: 'amber' },
    ])
  })
  it('tones Failed/Pending pods red', () => {
    const out = topRestarts([pod({ restarts: '1', ready: '1/1', phase: 'Pending' }, 'x')])
    expect(out[0].tone).toBe('red')
  })
  it('respects the limit', () => {
    const many = Array.from({ length: 20 }, (_, i) => pod({ restarts: String(i + 1) }, `p${i}`))
    expect(topRestarts(many, 3)).toHaveLength(3)
  })
})

describe('recentWarnings', () => {
  it('keeps only Warning, sorts by lastSeen desc, caps', () => {
    const out = recentWarnings([
      ev({ reason: 'Old', lastSeen: '2026-06-29T10:00:00Z' }),
      ev({ type: 'Normal', reason: 'Ignored', lastSeen: '2026-06-29T12:00:00Z' }),
      ev({ reason: 'New', lastSeen: '2026-06-29T11:00:00Z' }),
    ], 1)
    expect(out.map(e => e.reason)).toEqual(['New'])
  })
})

describe('relativeAge', () => {
  const now = Date.parse('2026-06-29T12:00:00Z')
  it('formats compact units', () => {
    expect(relativeAge('2026-06-29T11:59:30Z', now)).toBe('30s')
    expect(relativeAge('2026-06-29T11:55:00Z', now)).toBe('5m')
    expect(relativeAge('2026-06-29T09:00:00Z', now)).toBe('3h')
    expect(relativeAge('2026-06-27T12:00:00Z', now)).toBe('2d')
  })
  it('returns empty string for an invalid date', () => {
    expect(relativeAge('not-a-date', now)).toBe('')
  })
})
