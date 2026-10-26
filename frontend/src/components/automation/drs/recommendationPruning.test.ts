import { describe, expect, it } from 'vitest'

import {
  excessRecommendations,
  firstRejections,
  isMandatoryRecommendation,
  keptRecommendations,
  staleRecommendations,
  type PrunableRecommendation
} from './recommendationPruning'

const rec = (id: string, over: Partial<PrunableRecommendation> = {}): PrunableRecommendation => ({
  id, connection_id: 'c1', source_node: 'pve1', ...over,
})

const ids = (recs: PrunableRecommendation[]) => recs.map(r => r.id)

describe('isMandatoryRecommendation', () => {
  it('flags an evacuation and a rule violation only', () => {
    expect(isMandatoryRecommendation(rec('a', { maintenance_evacuation: true }))).toBe(true)
    expect(isMandatoryRecommendation(rec('b', { rule_violation: true }))).toBe(true)
    expect(isMandatoryRecommendation(rec('c'))).toBe(false)
  })
})

describe('keptRecommendations and excessRecommendations', () => {
  it('keeps the best ones up to maxPending per cluster', () => {
    const recs = [rec('a'), rec('b'), rec('c'), rec('x', { connection_id: 'c2' })]

    expect(ids(keptRecommendations(recs, 2))).toEqual(['a', 'b', 'x'])
    expect(ids(excessRecommendations(recs, 2))).toEqual(['c'])
  })

  it('keeps every evacuation of a node with more guests than maxPending', () => {
    const evacuation = Array.from({ length: 12 }, (_, i) => rec(`e${i}`, { maintenance_evacuation: true }))
    const recs = [...evacuation, rec('lb1'), rec('lb2')]

    expect(keptRecommendations(recs, 10)).toHaveLength(12)
    expect(ids(excessRecommendations(recs, 10))).toEqual(['lb1', 'lb2'])
  })

  it('counts mandatory ones against the room left for load balancing', () => {
    const recs = [rec('lb1'), rec('rule', { rule_violation: true }), rec('lb2'), rec('lb3')]

    expect(ids(keptRecommendations(recs, 3))).toEqual(['lb1', 'rule', 'lb2'])
    expect(ids(excessRecommendations(recs, 3))).toEqual(['lb3'])
  })
})

describe('staleRecommendations', () => {
  const metrics = {
    c1: { nodes: [{ node: 'pve1', memory_usage: 40 }, { node: 'pve2', memory_usage: 60 }, { node: 'pve3', memory_usage: 50 }] },
    c2: { nodes: [{ node: 'solo', memory_usage: 10 }] },
  }

  it('returns the load-balancing ones whose source is no longer above average', () => {
    const recs = [rec('cool', { source_node: 'pve1' }), rec('hot', { source_node: 'pve2' }), rec('edge', { source_node: 'pve3' })]

    expect(ids(staleRecommendations(recs, metrics))).toEqual(['cool', 'edge'])
  })

  it('never returns an evacuation or a rule violation', () => {
    const recs = [
      rec('evac', { source_node: 'pve1', maintenance_evacuation: true }),
      rec('rule', { source_node: 'pve1', rule_violation: true }),
    ]

    expect(staleRecommendations(recs, metrics)).toEqual([])
  })

  it('leaves a cluster without metrics, a one-node cluster and an unknown source alone', () => {
    const recs = [
      rec('nometrics', { connection_id: 'c9' }),
      rec('single', { connection_id: 'c2', source_node: 'solo' }),
      rec('unknown', { source_node: 'gone' }),
    ]

    expect(staleRecommendations(recs, metrics)).toEqual([])
  })
})

describe('firstRejections', () => {
  it('returns each recommendation once, however often it comes back', () => {
    const rejected = new Set<string>()

    expect(ids(firstRejections([rec('a'), rec('b')], rejected))).toEqual(['a', 'b'])
    expect(ids(firstRejections([rec('a'), rec('b'), rec('c')], rejected))).toEqual(['c'])
    expect(firstRejections([rec('a')], rejected)).toEqual([])
  })
})
