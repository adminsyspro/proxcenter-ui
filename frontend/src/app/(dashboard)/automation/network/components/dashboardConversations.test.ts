import { describe, expect, it } from 'vitest'

import type { MicrosegSuggestion } from '@/lib/microseg/types'

import { MAX_CONVERSATIONS, topConversations } from './dashboardConversations'

let seq = 0
const seen = (over: Partial<MicrosegSuggestion>): MicrosegSuggestion => ({
  id: `s${seq++}`, policy_id: 'p1', kind: 'would_block', src_key: 'zweb', src_ip: '10.0.0.1', src_zone_id: 'zweb', dst_ip: '10.0.0.2', dst_zone_id: 'zdb',
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
