import { describe, expect, it } from 'vitest'

import type { FirewallCoverage } from '@/hooks/useZeroTrust'
import type { MicrosegEvent, MicrosegSuggestion, MicrosegTraffic, MicrosegZone } from '@/lib/microseg/types'

import {
  pendingClusters,
  clusterFilter, eventGuestKey, flowCluster, guestVmid, guestsByCluster, guestsOf, mergeClusterEvents, mergeHistories, policyScope,
  shownFlows, shownIds,
} from './dashboardAggregate'
import { policyPeerOf } from './dashboardConversations'
import { postureTraffic } from './dashboardPosture'
import { postureTimeline } from './postureTimeline'
import type { PolicyGuest } from './microseg/zoneModel'

const link = (connection_id: string) => ({ connection_id })
const SEEN = [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }]

describe('policyScope', () => {
  const cases: [string, Parameters<typeof policyScope>, ReturnType<typeof policyScope>][] = [
    ['no connection', [[link('c1'), link('c2')], null, SEEN], { shared: false, readIds: [], hidden: 0 }],
    ['the policy not read yet', [undefined, 'c2', SEEN], { shared: false, readIds: ['c2'], hidden: 0 }],
    ['a policy of one cluster', [[link('c2')], 'c2', SEEN], { shared: false, readIds: ['c2'], hidden: 0 }],
    ['two clusters, the selected one first', [[link('c1'), link('c2')], 'c2', SEEN], { shared: true, readIds: ['c2', 'c1'], hidden: 0 }],
    ['three clusters, the others by ID', [[link('c3'), link('c1'), link('c2')], 'c2', SEEN], { shared: true, readIds: ['c2', 'c1', 'c3'], hidden: 0 }],
    ['a cluster outside the scope is not read', [[link('c1'), link('x9')], 'c1', SEEN], { shared: true, readIds: ['c1'], hidden: 1 }],
  ]
  it.each(cases)('%s', (_name, args, expected) => {
    expect(policyScope(...args)).toEqual(expected)
  })
})

describe('clusterFilter and shownIds', () => {
  const scope = policyScope([link('c1'), link('c2')], 'c1', SEEN)
  const cases: [string, Parameters<typeof clusterFilter>[0], string | undefined, string | null][] = [
    ['nothing picked', null, 'p1', null],
    ['a cluster of the policy', { policyId: 'p1', cluster: 'c2' }, 'p1', 'c2'],
    ['picked on another policy', { policyId: 'p0', cluster: 'c2' }, 'p1', null],
    ['a cluster no longer linked', { policyId: 'p1', cluster: 'c3' }, 'p1', null],
  ]
  it.each(cases)('%s', (_name, picked, policyId, expected) => {
    const filter = clusterFilter(picked, policyId, scope)
    expect(filter).toBe(expected)
    expect(shownIds(scope, filter)).toEqual(expected ? [expected] : ['c1', 'c2'])
  })

  it('never filters a policy of one cluster', () => {
    expect(clusterFilter({ policyId: 'p1', cluster: 'c1' }, 'p1', policyScope([link('c1')], 'c1', SEEN))).toBeNull()
  })
})

const flow = (connection_id: string, hits: number, over: Partial<MicrosegSuggestion> = {}) => ({
  id: `${connection_id}-${hits}`, policy_id: 'p1', kind: 'would_block', src_key: 'zweb', src_ip: '10.0.0.1', src_zone_id: 'zweb', dst_ip: '10.0.0.2',
  dst_zone_id: 'zdb', proto: 'tcp', dport: '5432', hits, first_seen: '', last_seen: '', status: 'pending', connection_id, ...over,
}) as MicrosegSuggestion

describe('shownFlows', () => {
  const rows = [flow('c1', 1), flow('c2', 2), flow('', 3), flow('x9', 4)]
  const shared = policyScope([link('c1'), link('c2'), link('x9')], 'c1', SEEN)
  it.each([
    ['a policy of one cluster keeps every row as read', policyScope([link('c1')], 'c1', SEEN), ['c1'], [1, 2, 3, 4]],
    ['the whole policy: the visible clusters, a row without cluster is the connection\'s', shared, ['c1', 'c2'], [1, 2, 3]],
    ['filtered on one cluster', shared, ['c2'], [2]],
  ] as const)('%s', (_name, scope, shown, hits) => {
    expect(shownFlows(rows, scope, shown)?.map(r => r.hits)).toEqual(hits)
  })

  it('keeps an unanswered read unanswered', () => {
    expect(shownFlows(undefined, shared, ['c1'])).toBeUndefined()
  })

  it('reads the cluster of a row, the connection for older data', () => {
    expect(flowCluster({ connection_id: 'c2' }, 'c1')).toBe('c2')
    expect(flowCluster({ connection_id: '' }, 'c1')).toBe('c1')
  })
})

const coverageRow = (vmid: number, tags: string[], vlans: number[] = []) => ({ type: 'qemu', node: 'pve1', vmid: String(vmid), name: `vm${vmid}`, tags, vlans })
const coverage = (rows: ReturnType<typeof coverageRow>[]) => ({ guests: rows }) as unknown as FirewallCoverage
const ZONES = [{ id: 'zweb', name: 'web', color: '#3b82f6', state: 'observe' }, { id: 'zdb', name: 'db', color: '#ef4444', state: 'enforce' }] as MicrosegZone[]

describe('guestsByCluster', () => {
  it('keeps the keys of a policy of one cluster as they were', () => {
    const one = guestsByCluster(policyScope([link('c1')], 'c1', SEEN), { c1: coverage([coverageRow(101, ['zone-web'])]) }, null)
    expect(one.c1.map(g => g.key)).toEqual(['qemu/101'])
  })

  it('adds up the guests of two clusters with the same VMID, and leaves out a cluster missing its coverage', () => {
    const scope = policyScope([link('c1'), link('c2'), link('c3')], 'c1', SEEN)
    const listed = [{ connectionId: 'c2', vmid: 101, type: 'qemu', name: 'web-dr', node: 'pve9', status: 'running', tags: ['zone-web'], ips: ['10.8.0.1'] }] as PolicyGuest[]
    const byCluster = guestsByCluster(scope, { c1: coverage([coverageRow(101, ['zone-web'])]), c2: coverage([coverageRow(101, ['zone-web'])]), c3: undefined }, listed)
    expect(guestsOf(byCluster, ['c1', 'c2', 'c3']).map(g => g.key)).toEqual(['c1|qemu/101', 'c2|qemu/101'])
    expect(byCluster.c2[0].ips).toEqual(['10.8.0.1'])
    expect(byCluster.c1[0].ips).toEqual([])
    expect(guestsOf(byCluster, ['c2']).map(guestVmid)).toEqual([101])
    // The zone counts its members of both clusters.
    const traffic = postureTraffic({ groupBy: 'zone', zones: ZONES, tagPrefix: 'zone-', suggestions: [flow('c1', 3), flow('c2', 5)], guests: guestsOf(byCluster, ['c1', 'c2']), addresses: false })
    const web = traffic.slices.find(s => s.key === 'zone:zweb')!
    expect([web.hits, web.members]).toEqual([8, 2])
  })
})

const traffic = (step: number, hits: number[]): MicrosegTraffic => ({
  step, from: '2026-11-17T08:00:00Z', to: '2026-11-17T09:00:00Z',
  buckets: hits.map(h => ({ at: '2026-11-17T08:30:00Z', zone: 'db', src_zone: 'web', verdict: 'would_block', hits: h })) as MicrosegTraffic['buckets'],
})

describe('mergeHistories', () => {
  const cases: [string, (MicrosegTraffic | undefined)[], number[] | undefined][] = [
    ['nothing answered yet', [undefined, undefined], undefined],
    ['one cluster answered', [undefined, traffic(300, [4])], [4]],
    ['the rows of every cluster', [traffic(300, [4]), traffic(300, [6, 1])], [4, 6, 1]],
    ['a cluster still on the previous range waits', [traffic(300, [4]), traffic(900, [6])], [4]],
  ]
  it.each(cases)('%s', (_name, answers, hits) => {
    expect(mergeHistories(answers)?.buckets.map(b => b.hits)).toEqual(hits)
  })

  it('hands back the answer of a single cluster as it is', () => {
    const one = traffic(300, [4])
    expect(mergeHistories([one])).toBe(one)
  })
})

const event = (seq: number, vmid: number): MicrosegEvent => ({
  seq, ts: '2026-11-17T08:30:00Z', node: 'pve1', vmid, type: 'qemu', guest: `vm${vmid}`, zone: 'db', src_zone: 'web', src_ip: '10.0.0.1',
  dst_ip: '10.0.0.2', proto: 'tcp', dport: 5432, verdict: 'would_block',
})

describe('mergeClusterEvents', () => {
  it('hands back the events of one cluster as they are', () => {
    const own = [event(1, 101)]
    expect(mergeClusterEvents([{ cluster: 'c1', events: own }], false)).toBe(own)
  })

  it('tags each event with its cluster on a shared policy, and leaves out a cluster that did not answer', () => {
    const merged = mergeClusterEvents([{ cluster: 'c1', events: [event(1, 101)] }, { cluster: 'c2', events: undefined }, { cluster: 'c3', events: [event(1, 101)] }], true)
    expect(merged?.map(e => [e.cluster, eventGuestKey(e)])).toEqual([['c1', 'c1|qemu/101'], ['c3', 'c3|qemu/101']])
  })

  it('is undefined until one cluster answered', () => {
    expect(mergeClusterEvents([{ cluster: 'c1', events: undefined }], true)).toBeUndefined()
  })

  it('groups an event by the VLAN of the guest of its own cluster', () => {
    const scope = policyScope([link('c1'), link('c2')], 'c1', SEEN)
    const byCluster = guestsByCluster(scope, { c1: coverage([coverageRow(101, [], [10])]), c2: coverage([coverageRow(101, [], [20])]) }, null)
    const events = mergeClusterEvents([{ cluster: 'c1', events: [event(1, 101)] }, { cluster: 'c2', events: [event(2, 101), event(3, 101)] }], true)!
    const slices = [{ key: 'vlan:10', kind: 'vlan', name: '10', color: '#000' }, { key: 'vlan:20', kind: 'vlan', name: '20', color: '#111' }] as const
    const chart = postureTimeline({ events, groupBy: 'vlan', verdict: 'all', zones: ZONES, guests: guestsOf(byCluster, ['c1', 'c2']), addresses: false, slices: [...slices], now: Date.parse('2026-11-17T08:40:00Z') })
    const counts = chart.buckets.reduce<Record<string, number>>((sum, b) => {
      for (const [k, v] of Object.entries(b.counts)) sum[k] = (sum[k] ?? 0) + v
      return sum
    }, {})
    expect(counts).toEqual({ 'vlan:10': 1, 'vlan:20': 2 })
  })
})

describe('policyPeerOf', () => {
  const guests = [
    { connectionId: 'c1', vmid: 101, type: 'qemu', name: 'web1', node: 'pve1', status: 'running', tags: ['zone-web'], ips: ['10.0.0.1'] },
    { connectionId: 'c2', vmid: 101, type: 'qemu', name: 'web-dr', node: 'pve9', status: 'running', tags: ['zone-web'], ips: ['10.8.0.1'] },
  ] as PolicyGuest[]
  const peerOf = policyPeerOf({ fallback: 'c1', guests, zones: ZONES, tagPrefix: 'zone-', hiddenClusters: false })

  it.each([
    ['logged on c1 from a guest of c2', flow('c1', 1, { src_ip: '10.8.0.1' }), { end: 'src', cluster: 'c2', zoneId: 'zweb', guest: 'web-dr' }],
    ['logged on c2 from a guest of c1', flow('c2', 1, { src_ip: '10.0.0.1' }), { end: 'src', cluster: 'c1', zoneId: 'zweb', guest: 'web1' }],
    ['logged on c2 from its own guest', flow('c2', 1, { src_ip: '10.8.0.1' }), null],
    ['older data without cluster, read through c1', flow('', 1, { src_ip: '10.8.0.1' }), { end: 'src', cluster: 'c2', zoneId: 'zweb', guest: 'web-dr' }],
  ] as const)('%s', (_name, s, expected) => {
    expect(peerOf(s)).toEqual(expected)
  })
})

describe('pendingClusters', () => {
  it('lists the clusters that neither answered nor failed, in order', () => {
    expect(pendingClusters(['a', 'b', 'c'], { byCluster: { a: 1 }, errors: { c: new Error('x') } })).toEqual(['b'])
  })

  it('lists nothing once every cluster answered or failed, and for no cluster at all', () => {
    expect(pendingClusters(['a', 'b'], { byCluster: { a: 1, b: 2 }, errors: {} })).toEqual([])
    expect(pendingClusters(['a', 'b'], { byCluster: {}, errors: { a: 1, b: 2 } })).toEqual([])
    expect(pendingClusters([], { byCluster: {}, errors: {} })).toEqual([])
  })

  it('lets a later answer take a cluster out of the list', () => {
    expect(pendingClusters(['a'], { byCluster: { a: undefined }, errors: {} })).toEqual(['a'])
    expect(pendingClusters(['a'], { byCluster: { a: 1 }, errors: {} })).toEqual([])
  })
})
