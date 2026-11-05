import { describe, expect, it } from 'vitest'

import type { MicrosegEvent, MicrosegFlow, MicrosegSuggestion, MicrosegZone } from '@/lib/microseg/types'

import { newPairFlow, pairEndOf, pairEventFilter, pairFlows, pairSuggestions, trafficPairOf } from './pairModel'

const zone = (id: string, name: string) => ({ id, name }) as MicrosegZone
const zones = new Map([zone('zw', 'web'), zone('zd', 'db')].map(z => [z.id, z]))
const flowOf = (id: string, over: Partial<MicrosegFlow> = {}) => ({ id, src_zone_id: 'zw', src_cidr: '', dst_zone_id: 'zd', dst_cidr: '', proto: 'tcp', dport: '443', ...over }) as MicrosegFlow
const wouldBlock = (id: string, over: Partial<MicrosegSuggestion> = {}) => ({
  id, kind: 'would_block', status: 'pending', src_key: 'zw', src_zone_id: 'zw', dst_zone_id: 'zd', src_ip: '', dst_ip: '', proto: 'tcp', dport: '80', hits: 1, ...over,
}) as MicrosegSuggestion
const end = (id: string) => pairEndOf(id, zones, id)

describe('pairEndOf', () => {
  it('reads a zone, the boundaries, the unzoned guests and an address', () => {
    expect(end('zone:zw')).toMatchObject({ kind: 'zone', zone: { id: 'zw' } })
    expect(end('zone:gone')).toMatchObject({ kind: 'external', zone: null })
    expect(end('external').kind).toBe('external')
    expect(end('outside').kind).toBe('outside')
    expect(end('unzoned').kind).toBe('unzoned')
    expect(end('ip:203.0.113.9').kind).toBe('ip')
    expect(end('something').kind).toBe('ip')
  })
})

describe('trafficPairOf and pairEventFilter', () => {
  it('names the pair after its zones, empty for an end in no zone, and keeps its events both ways', () => {
    expect(trafficPairOf(end('zone:zw'), end('outside'))).toEqual({ emitter: 'web', receiver: '' })
    const keep = pairEventFilter(trafficPairOf(end('zone:zw'), end('zone:zd')))
    const ev = (over: Partial<MicrosegEvent>) => ({ zone: 'db', src_zone: 'web', ...over }) as MicrosegEvent
    expect(keep(ev({}))).toBe(true)
    expect(keep(ev({ direction: 'out', zone: 'WEB', src_zone: 'db' }))).toBe(true)
    expect(keep(ev({ zone: 'web', src_zone: 'db' }))).toBe(false)
    expect(keep(ev({ direction: 'out' }))).toBe(false)
  })
})

describe('pairSuggestions', () => {
  it('keeps the observed flows of the edge, adds towards Outside the pending outbound ones of the source zone, busiest first', () => {
    const observed = [wouldBlock('a', { hits: 1 })]
    const all = [
      wouldBlock('o1', { direction: 'out', src_key: 'zw', dst_zone_id: '', hits: 5 }),
      wouldBlock('o2', { direction: 'out', src_zone_id: '', src_key: 'zw', dst_zone_id: '', hits: 2 }),
      wouldBlock('o3', { direction: 'out', src_zone_id: 'zd', src_key: 'zd', dst_zone_id: '' }),
      wouldBlock('o4', { direction: 'out', src_key: 'zw', dst_zone_id: 'zd' }),
      wouldBlock('o5', { direction: 'out', src_key: 'zw', dst_zone_id: '', status: 'dismissed' }),
    ]
    expect(pairSuggestions(observed, all, end('zone:zw'), end('outside')).map(s => s.id)).toEqual(['o1', 'o2', 'a'])
    expect(pairSuggestions(observed, all, end('zone:zw'), end('zone:zd')).map(s => s.id)).toEqual(['a'])
  })
})

describe('pairFlows and newPairFlow', () => {
  const flows = [
    flowOf('f2'),
    flowOf('f1'),
    flowOf('back', { src_zone_id: 'zd', dst_zone_id: 'zw' }),
    flowOf('out', { dst_zone_id: '', dst_cidr: '0.0.0.0/0' }),
    flowOf('in', { src_zone_id: '', src_cidr: '203.0.113.0/24' }),
  ]
  it('keeps the flows declared from the source to the destination, in id order', () => {
    expect(pairFlows(flows, end('zone:zw'), end('zone:zd'), []).map(f => f.id)).toEqual(['f1', 'f2'])
    expect(pairFlows(flows, end('zone:zw'), end('outside'), []).map(f => f.id)).toEqual(['out'])
    expect(pairFlows(flows, end('external'), end('zone:zd'), []).map(f => f.id)).toEqual(['in'])
  })
  it('falls back on the edge own flows between unzoned guests or addresses', () => {
    expect(pairFlows(flows, end('unzoned'), end('zone:zd'), [flows[0]]).map(f => f.id)).toEqual(['f2'])
  })
  it('prefills a new flow with the zones of the pair, none without a zone', () => {
    expect(newPairFlow(end('zone:zw'), end('zone:zd'))).toEqual({ src_zone_id: 'zw', dst_zone_id: 'zd' })
    expect(newPairFlow(end('zone:zw'), end('outside'))).toEqual({ src_zone_id: 'zw' })
    expect(newPairFlow(end('external'), end('zone:zd'))).toEqual({ dst_zone_id: 'zd' })
    expect(newPairFlow(end('external'), end('outside'))).toBeNull()
  })
})
