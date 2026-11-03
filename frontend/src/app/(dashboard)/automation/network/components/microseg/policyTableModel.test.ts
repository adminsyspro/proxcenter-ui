import { describe, expect, it } from 'vitest'

import { policyDiff } from '@/lib/microseg/pendingChanges'
import type { MicrosegFlow, MicrosegZone } from '@/lib/microseg/types'

import { OUTSIDE_GROUP, flowGroups, flowHits, flowState, matchesFilter } from './policyTableModel'
import { hitsByPair, hitsWindow, pairKey } from './useFlowHits'

const zone = (id: string, name = id): MicrosegZone => ({
  id, policy_id: 'p', name, label: '', color: '#fff', enforcement: 'guest', vnet_id: '', state: 'observe', isolate_members: false, observe_since: null,
})
const flow = (id: string, over: Partial<MicrosegFlow> = {}): MicrosegFlow => ({
  id, policy_id: 'p', src_zone_id: 'zw', src_cidr: '', dst_zone_id: 'zd', dst_cidr: '', proto: 'tcp', dport: '443', comment: '', origin: 'manual', created_by: 'me', ...over,
})
const web = zone('zw', 'web')
const db = zone('zd', 'db')
const byId = new Map([web, db].map(z => [z.id, z]))
const revision = (zones: MicrosegZone[], flows: MicrosegFlow[]) => ({ id: 'r', version: 1, author: '', created_at: '', snapshot: { tag_prefix: 'zone-', zones, flows } })

describe('flowState', () => {
  const diff = policyDiff({ zones: [web, db], flows: [flow('kept'), flow('new'), flow('cidr', { dst_zone_id: '', dst_cidr: '10.0.0.0/8' }), flow('edit', { dport: '22' })], pending_members: [] },
    revision([web, db], [flow('kept'), flow('edit'), flow('gone')]))

  it('says removed first, then not applied for a CIDR destination, then added or changed, applied otherwise', () => {
    expect(flowState(flow('kept'), diff)).toBe('applied')
    expect(flowState(flow('new'), diff)).toBe('pendingAdd')
    expect(flowState(flow('edit', { dport: '22' }), diff)).toBe('pendingChange')
    expect(flowState(flow('gone'), diff)).toBe('pendingRemoval')
    expect(flowState(flow('cidr', { dst_zone_id: '', dst_cidr: '10.0.0.0/8' }), diff)).toBe('notApplied')
  })

  it('is unknown while the revision is read, except a CIDR destination', () => {
    expect(flowState(flow('kept'), null)).toBe('unknown')
    expect(flowState(flow('x', { dst_cidr: '10.0.0.0/8' }), null)).toBe('notApplied')
  })
})

describe('hits', () => {
  it('reads the 24 hours that end with the current hour', () => {
    const now = Date.parse('2026-11-03T10:25:00Z')
    expect(hitsWindow(now)).toEqual({ from: Date.parse('2026-11-02T11:00:00Z'), to: Date.parse('2026-11-03T11:00:00Z') })
  })

  it('sums every verdict and bucket of a zone pair, whatever the case', () => {
    const pairs = hitsByPair({ buckets: [
      { at: 'a', zone: 'db', src_zone: 'web', verdict: 'would_block', hits: 2 },
      { at: 'b', zone: 'DB', src_zone: 'Web', verdict: 'blocked', hits: 3 },
      { at: 'a', zone: 'web', src_zone: '', verdict: 'would_block', hits: 1 },
    ] })
    expect(pairs.get(pairKey('web', 'db'))).toBe(5)
    expect(pairs.get(pairKey('', 'web'))).toBe(1)
  })

  it('joins a flow by its zones; an any-address source takes the hits from no zone; others give a reason', () => {
    const pairs = new Map([[pairKey('web', 'db'), 7], [pairKey('', 'db'), 4]])
    expect(flowHits(flow('a'), byId, pairs, false)).toEqual({ value: 7 })
    expect(flowHits(flow('b', { src_zone_id: 'zd', dst_zone_id: 'zw' }), byId, pairs, false)).toEqual({ value: 0 })
    expect(flowHits(flow('c', { src_zone_id: '', src_cidr: '0.0.0.0/0' }), byId, pairs, false)).toEqual({ value: 4 })
    expect(flowHits(flow('d', { src_zone_id: '', src_cidr: '10.1.0.0/16' }), byId, pairs, false)).toEqual({ value: null, reason: 'cidrSource' })
    expect(flowHits(flow('e', { dst_zone_id: '', dst_cidr: '10.0.0.0/8' }), byId, pairs, false)).toEqual({ value: null, reason: 'cidrDestination' })
    expect(flowHits(flow('f'), byId, null, false)).toEqual({ value: null, reason: 'loading' })
    expect(flowHits(flow('g'), byId, null, true)).toEqual({ value: null, reason: 'unavailable' })
  })
})

describe('flowGroups', () => {
  it('orders the draft zones, then the removed zones, then the CIDR destinations, and drops the empty groups', () => {
    const old = zone('zo', 'old')
    const flows = [flow('f1', { dst_zone_id: 'zw', src_zone_id: 'zd' }), flow('f2', { dst_zone_id: '', dst_cidr: '10.0.0.0/8' })]
    const diff = policyDiff({ zones: [web, db], flows, pending_members: [] }, revision([web, db, old], [flow('f3', { dst_zone_id: 'zo' }), ...flows]))
    const groups = flowGroups({ zones: [web, db], flows, diff, pairs: null, failed: false, filter: '', sort: 'source' })
    expect(groups.map(g => [g.key, g.zoneRemoved, g.rows.map(r => [r.flow.id, r.removed])])).toEqual([
      ['zw', false, [['f1', false]]],
      ['zo', true, [['f3', true]]],
      [OUTSIDE_GROUP, false, [['f2', false]]],
    ])
  })

  it('sorts by source then service, or by hits with the uncounted last', () => {
    const app = zone('za', 'app')
    const zones = [web, db, app]
    const flows = [flow('f1', { src_zone_id: 'zw', dport: '22' }), flow('f2', { src_zone_id: 'za' }), flow('f3', { src_zone_id: '', src_cidr: '10.0.0.0/8' })]
    const pairs = new Map([[pairKey('web', 'db'), 9], [pairKey('app', 'db'), 1]])
    const ids = (sort: 'source' | 'hits') => flowGroups({ zones, flows, diff: null, pairs, failed: false, filter: '', sort })[0].rows.map(r => r.flow.id)
    expect(ids('source')).toEqual(['f3', 'f2', 'f1'])
    expect(ids('hits')).toEqual(['f1', 'f2', 'f3'])
  })

  it('filters on the zone names, the CIDRs and the service, whatever the case', () => {
    expect(matchesFilter(flow('a'), byId, 'WEB')).toBe(true)
    expect(matchesFilter(flow('a'), byId, 'https')).toBe(true)
    expect(matchesFilter(flow('a'), byId, 'tcp/443')).toBe(true)
    expect(matchesFilter(flow('a', { src_zone_id: '', src_cidr: '192.0.2.0/24' }), byId, '192.0.2')).toBe(true)
    expect(matchesFilter(flow('a'), byId, 'ssh')).toBe(false)
    expect(matchesFilter(flow('a'), byId, '  ')).toBe(true)
  })
})
