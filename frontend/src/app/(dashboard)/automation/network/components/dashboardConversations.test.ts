import { describe, expect, it } from 'vitest'

import type { MicrosegSuggestion } from '@/lib/microseg/types'

import { MAX_CONVERSATIONS, remotePeerOf, topConversations } from './dashboardConversations'
import type { PolicyGuest } from './microseg/zoneModel'

let seq = 0
const seen = (over: Partial<MicrosegSuggestion>): MicrosegSuggestion => ({
  id: `s${seq++}`, policy_id: 'p1', connection_id: 'c1', kind: 'would_block', src_key: 'zweb', src_ip: '10.0.0.1', src_zone_id: 'zweb', dst_ip: '10.0.0.2', dst_zone_id: 'zdb',
  proto: 'tcp', dport: '5432', hits: 10, first_seen: '', last_seen: '', status: 'pending', ...over,
})

describe('topConversations', () => {
  it('groups the flows of one source, destination and way, the busiest first, its services and types busiest first', () => {
    const { rows, total } = topConversations([
      seen({ hits: 300 }),
      seen({ dport: '22', hits: 40, kind: 'blocked' }),
      seen({ proto: 'udp', dport: '22', hits: 5, kind: 'blocked' }),
      seen({ src_key: '203.0.113.9', src_ip: '203.0.113.9', src_zone_id: '', dst_ip: '10.0.0.1', dst_zone_id: 'zweb', dport: '22', hits: 100 }),
    ])

    expect(total).toBe(2)
    expect(rows.map(r => [r.key, r.flows, r.hits])).toEqual([['in|zweb|zdb', 3, 345], ['in|ip:203.0.113.9|zweb', 1, 100]])
    expect(rows[0].services).toEqual(['PostgreSQL', 'SSH'])
    expect(rows[0].parts).toEqual([{ kind: 'would_block', flows: 1, hits: 300 }, { kind: 'blocked', flows: 2, hits: 45 }])
    expect(rows[0].sample.hits).toBe(300)
  })

  it('tells the ways apart, and an outbound flow by its emitting zone and destination', () => {
    const { rows } = topConversations([
      seen({ direction: 'out', src_zone_id: 'zweb', dst_zone_id: '', dst_ip: '1.1.1.1', dst_key: '1.1.1.1', dport: '443', hits: 20 }),
      seen({ direction: 'out', src_zone_id: '', src_key: 'zweb', dst_zone_id: '', dst_ip: '', dst_key: '0.0.0.0/0', dport: '80', hits: 10 }),
      seen({ direction: 'out', src_zone_id: '', src_key: 'zweb', dst_zone_id: '', dst_ip: '', dst_key: '::/0', dport: '80', hits: 5 }),
      seen({ hits: 1 }),
    ])

    expect(rows.map(r => r.key)).toEqual(['out|zweb|ip:1.1.1.1', 'out|zweb|many', 'in|zweb|zdb'])
    expect(rows[1].flows).toBe(2)
    expect(rows.map(r => r.focus)).toEqual([{ zoneId: 'zweb' }, { zoneId: 'zweb' }, { zoneId: 'zdb' }])
  })

  it('opens the unknown sources when the flow has no zone to open', () => {
    const { rows } = topConversations([seen({ src_zone_id: '', src_key: '', src_ip: '192.0.2.1', dst_zone_id: '', dst_ip: '10.0.0.9' })])

    expect(rows[0].focus).toEqual({ source: 'unknown' })
  })

  it('keeps the busiest ones and counts them all, leaving out the flows already decided', () => {
    const many = Array.from({ length: MAX_CONVERSATIONS + 3 }, (_, i) => seen({ src_zone_id: '', src_key: '', src_ip: `192.0.2.${i}`, hits: i }))
    const { rows, total } = topConversations([...many, seen({ status: 'accepted', hits: 999 })])

    expect(total).toBe(MAX_CONVERSATIONS + 3)
    expect(rows).toHaveLength(MAX_CONVERSATIONS)
    expect(rows[0].hits).toBe(MAX_CONVERSATIONS + 2)
  })

  it('is empty without flows', () => {
    expect(topConversations([])).toEqual({ rows: [], total: 0 })
  })
})

describe('remotePeerOf', () => {
  const zone = (id: string, name: string) => ({ id, policy_id: 'p1', name, label: '', color: '#3b82f6', enforcement: 'guest' as const, vnet_id: '', state: 'observe' as const, isolate_members: false, observe_since: null })
  const ZONES = [zone('zweb', 'web'), zone('zdb', 'db')]
  const guest = (connectionId: string, vmid: number, name: string, tags: string[], ips: string[]): PolicyGuest => ({ connectionId, vmid, name, node: 'pve1', type: 'qemu', status: 'running', tags, ips })
  const LOCAL = [guest('c1', 101, 'web1', ['zone-web'], ['10.0.0.1']), guest('c1', 102, 'db1', ['zone-db'], ['10.0.0.2'])]
  const REMOTE = [guest('c2', 101, 'web-dr', ['zone-web'], ['10.8.0.1/24']), guest('c2', 105, 'lab-dr', [], ['10.8.0.9'])]
  const lookup = (o: { guests?: PolicyGuest[]; hidden?: boolean } = {}) => remotePeerOf({
    connectionId: 'c1', guests: o.guests ?? [...LOCAL, ...REMOTE], zones: ZONES, tagPrefix: 'zone-', hiddenClusters: o.hidden ?? false,
  })

  it('names the cluster and the zone of a source that is a member on another cluster', () => {
    const peer = lookup()(seen({ src_key: 'zweb', src_ip: '10.8.0.1', src_zone_id: 'zweb' }))
    expect(peer).toEqual({ end: 'src', cluster: 'c2', zoneId: 'zweb', guest: 'web-dr' })
  })

  it('puts a source the engine left in no zone on the zone of its tag, and a remote guest in no zone on its name', () => {
    expect(lookup()(seen({ src_key: '10.8.0.1', src_ip: '10.8.0.1', src_zone_id: '' }))).toEqual({ end: 'src', cluster: 'c2', zoneId: 'zweb', guest: 'web-dr' })
    expect(lookup()(seen({ src_key: '10.8.0.9', src_ip: '10.8.0.9', src_zone_id: '' }))).toEqual({ end: 'src', cluster: 'c2', zoneId: '', guest: 'lab-dr' })
  })

  it('takes the destination of an outbound flow, never the many destinations of an aggregate', () => {
    expect(lookup()(seen({ direction: 'out', src_zone_id: 'zdb', src_key: 'zdb', src_ip: '10.0.0.2', dst_ip: '10.8.0.1', dst_zone_id: 'zweb' })))
      .toEqual({ end: 'dst', cluster: 'c2', zoneId: 'zweb', guest: 'web-dr' })
    expect(lookup()(seen({ direction: 'out', src_zone_id: 'zdb', src_key: 'zdb', dst_ip: '', dst_zone_id: '', dst_key: '0.0.0.0/0' }))).toBeNull()
  })

  it('leaves a guest of this cluster and an address no guest carries alone', () => {
    expect(lookup()(seen({}))).toBeNull()
    // The same address on both clusters: the guest of this cluster.
    expect(lookup({ guests: [...LOCAL, guest('c2', 9, 'twin', ['zone-db'], ['10.0.0.1'])] })(seen({}))).toBeNull()
    expect(lookup()(seen({ src_key: '203.0.113.9', src_ip: '203.0.113.9', src_zone_id: '' }))).toBeNull()
  })

  it('keeps the flows of a member of another cluster apart from those of the same zone on this cluster', () => {
    const peerOf = lookup()
    const { rows, total } = topConversations([seen({ hits: 30 }), seen({ src_ip: '10.8.0.1', hits: 50 }), seen({ src_ip: '10.8.0.1', dport: '22', hits: 5 })], MAX_CONVERSATIONS, peerOf)

    expect(total).toBe(2)
    expect(rows.map(r => [r.key, r.hits, r.peer?.cluster ?? null])).toEqual([['in|zweb|zdb|c2', 55, 'c2'], ['in|zweb|zdb', 30, null]])
  })

  it('says another cluster for a zoned address no guest the user sees carries, when a cluster of the policy is hidden', () => {
    const flow = seen({ src_ip: '10.7.0.4', src_zone_id: 'zweb' })
    expect(lookup({ hidden: true })(flow)).toEqual({ end: 'src', cluster: null, zoneId: 'zweb' })
    expect(lookup()(flow)).toBeNull()
    // The addresses of this cluster are not known (inventory refused): nothing can be told.
    expect(lookup({ hidden: true, guests: LOCAL.map(g => ({ ...g, ips: [] })) })(flow)).toBeNull()
  })

  it('does not say another cluster when a member of that zone on this cluster has no known address', () => {
    const flow = seen({ src_ip: '10.7.0.4', src_zone_id: 'zweb' })
    // web-noagent (web, here, no guest agent) may be the source: nothing is said.
    expect(lookup({ hidden: true, guests: [...LOCAL, guest('c1', 103, 'web-noagent', ['zone-web'], [])] })(flow)).toBeNull()
    // A member of another zone without address changes nothing for web.
    expect(lookup({ hidden: true, guests: [...LOCAL, guest('c1', 104, 'db-noagent', ['zone-db'], [])] })(flow)).toEqual({ end: 'src', cluster: null, zoneId: 'zweb' })
  })

  it('does not guess between two other clusters that carry the same address', () => {
    const twins = [...LOCAL, guest('c2', 101, 'web-dr', ['zone-web'], ['10.8.0.1']), guest('c3', 301, 'web-bk', ['zone-db'], ['10.8.0.1'])]
    expect(lookup({ guests: twins })(seen({ src_ip: '10.8.0.1', src_zone_id: 'zweb' }))).toEqual({ end: 'src', cluster: null, zoneId: 'zweb' })
    // The engine left it in no zone: no zone either (the two tags disagree).
    expect(lookup({ guests: twins })(seen({ src_key: '10.8.0.1', src_ip: '10.8.0.1', src_zone_id: '' }))).toEqual({ end: 'src', cluster: null, zoneId: '' })
  })
})
