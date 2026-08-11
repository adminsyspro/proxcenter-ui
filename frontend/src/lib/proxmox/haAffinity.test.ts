import { describe, it, expect } from 'vitest'

import {
  parseRuleResources,
  getServicePlacements,
  getAffinityPeers,
  computeNegativeAffinityConflicts,
  type HaRule,
  type HaStatusEntry,
} from './haAffinity'

const status: HaStatusEntry[] = [
  { id: 'quorum', type: 'quorum', node: 'pve1' },
  { id: 'master', type: 'master', node: 'pve1' },
  { id: 'lrm:pve2', type: 'lrm', node: 'pve2' },
  { id: 'service:vm:20026', type: 'service', sid: 'vm:20026', node: 'pve1', state: 'started' },
  { id: 'service:vm:20027', type: 'service', sid: 'vm:20027', node: 'pve2', state: 'started' },
  { id: 'service:ct:300', type: 'service', sid: 'ct:300', node: 'pve3', state: 'stopped' },
]

const rules: HaRule[] = [
  { rule: 'keep-apart', type: 'resource-affinity', affinity: 'negative', resources: 'vm:20026, vm:20027' },
  { rule: 'keep-together', type: 'resource-affinity', affinity: 'positive', resources: 'vm:20026,ct:300' },
  { rule: 'pin-nodes', type: 'node-affinity', resources: 'vm:20026' },
]

describe('parseRuleResources', () => {
  it('splits and trims a comma-separated sid list', () => {
    expect(parseRuleResources('vm:100, ct:101,vm:102')).toEqual(['vm:100', 'ct:101', 'vm:102'])
  })

  it('returns an empty list for non-string input', () => {
    expect(parseRuleResources(undefined)).toEqual([])
    expect(parseRuleResources(42)).toEqual([])
    expect(parseRuleResources('')).toEqual([])
  })
})

describe('getServicePlacements', () => {
  it('maps service sids to their current node and state', () => {
    const placements = getServicePlacements(status)

    expect(placements.get('vm:20027')).toEqual({ node: 'pve2', state: 'started' })
    expect(placements.get('ct:300')).toEqual({ node: 'pve3', state: 'stopped' })
  })

  it('ignores non-service entries', () => {
    const placements = getServicePlacements(status)

    expect(placements.has('quorum')).toBe(false)
    expect(placements.size).toBe(3)
  })

  it('falls back to parsing the id when sid is missing', () => {
    const placements = getServicePlacements([{ id: 'service:vm:9', type: 'service', node: 'pveX', state: 'started' }])

    expect(placements.get('vm:9')).toEqual({ node: 'pveX', state: 'started' })
  })

  it('handles null and undefined input', () => {
    expect(getServicePlacements(null).size).toBe(0)
    expect(getServicePlacements(undefined).size).toBe(0)
  })
})

describe('getAffinityPeers', () => {
  it('returns negative-affinity peers with their placement', () => {
    expect(getAffinityPeers('vm:20026', rules, 'negative', status)).toEqual([
      { sid: 'vm:20027', rule: 'keep-apart', node: 'pve2', state: 'started', running: true },
    ])
  })

  it('returns positive-affinity peers, flagging non-running ones', () => {
    expect(getAffinityPeers('vm:20026', rules, 'positive', status)).toEqual([
      { sid: 'ct:300', rule: 'keep-together', node: 'pve3', state: 'stopped', running: false },
    ])
  })

  it('ignores disabled rules', () => {
    const disabled = [{ ...rules[0], disable: 1 }]

    expect(getAffinityPeers('vm:20026', disabled, 'negative', status)).toEqual([])
  })

  it('ignores rules that do not include the vm', () => {
    expect(getAffinityPeers('vm:999', rules, 'negative', status)).toEqual([])
  })

  it('ignores node-affinity rules', () => {
    const nodeOnly = [{ rule: 'pin', type: 'node-affinity', resources: 'vm:20026,vm:20027' }]

    expect(getAffinityPeers('vm:20026', nodeOnly, 'negative', status)).toEqual([])
  })

  it('reports peers without a known placement', () => {
    expect(getAffinityPeers('vm:20026', rules, 'negative', [])).toEqual([
      { sid: 'vm:20027', rule: 'keep-apart', node: null, state: null, running: false },
    ])
  })

  it('dedupes a peer paired through several rules', () => {
    const twoRules = [
      rules[0],
      { rule: 'keep-apart-bis', type: 'resource-affinity', affinity: 'negative', resources: 'vm:20026,vm:20027' },
    ]

    expect(getAffinityPeers('vm:20026', twoRules, 'negative', status)).toHaveLength(1)
  })
})

describe('computeNegativeAffinityConflicts', () => {
  it('groups conflicting peers by their current node', () => {
    const conflicts = computeNegativeAffinityConflicts('vm:20026', rules, status)

    expect([...conflicts.keys()]).toEqual(['pve2'])
    expect(conflicts.get('pve2')).toEqual([
      { sid: 'vm:20027', rule: 'keep-apart', node: 'pve2', state: 'started', running: true },
    ])
  })

  it('sees the conflict from the other resource of the pair too', () => {
    const conflicts = computeNegativeAffinityConflicts('vm:20027', rules, status)

    expect(conflicts.get('pve1')?.[0]?.sid).toBe('vm:20026')
  })

  it('skips peers without a placement', () => {
    expect(computeNegativeAffinityConflicts('vm:20026', rules, []).size).toBe(0)
  })

  it('returns an empty map when there are no rules', () => {
    expect(computeNegativeAffinityConflicts('vm:20026', [], status).size).toBe(0)
    expect(computeNegativeAffinityConflicts('vm:20026', undefined, status).size).toBe(0)
  })
})
