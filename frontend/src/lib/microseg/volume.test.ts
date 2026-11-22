import { describe, expect, it } from 'vitest'

import type { MicrosegFlow, MicrosegSuggestion, MicrosegVolume, MicrosegVolumeBucket } from './types'
import {
  VOLUME_LEVELS, flowRules, mergeVolume, portInSpec, protoOf, ruleMatches, tokenRule, totalOf, volumeByService, volumeOf,
  VOLUME_FEW_SAMPLES, addVolume, fewSamples, sharedEnd, volumeLevel, volumePeriodOf, volumeSeries, volumeText, volumeWindow,
} from './volume'

const row = (src: string, dst: string, proto: string, port: number, bytes: number, packets = 1): MicrosegVolumeBucket => ({
  at: '2026-11-20T10:00:00Z', src_zone: src, dst_zone: dst, proto, port, bytes, packets,
})

const ROWS = [
  row('web', 'db', 'tcp', 5432, 1000, 10),
  row('web', 'db', 'tcp', 9100, 50, 5),
  row('web', 'db', 'icmp', 0, 7, 7),
  row('', 'web', 'tcp', 443, 300, 3),
  row('db', '', 'udp', 53, 20, 2),
]

const flow = (over: Partial<MicrosegFlow>): MicrosegFlow => ({
  id: 'f', policy_id: 'p', src_zone_id: 'zweb', src_cidr: '', dst_zone_id: 'zdb', dst_cidr: '', proto: 'tcp', dport: '5432', comment: '', origin: 'manual', created_by: '', ...over,
} as MicrosegFlow)
const NAMES: Record<string, string> = { zweb: 'web', zdb: 'db' }
const zoneName = (id: string) => NAMES[id]

describe('ports and protocols', () => {
  it('reads a port list: one port, a list, a range, every port when empty', () => {
    expect(portInSpec(22, '22')).toBe(true)
    expect(portInSpec(443, '80,443')).toBe(true)
    expect(portInSpec(8050, '8000:8100')).toBe(true)
    expect(portInSpec(9000, '8000:8100')).toBe(false)
    expect(portInSpec(1, ' ')).toBe(true)
  })

  it('names a protocol as the policy writes it', () => {
    expect(protoOf(' TCP ')).toBe('tcp')
    expect(protoOf('ipv6-icmp')).toBe('icmpv6')
    expect(protoOf('icmp6')).toBe('icmpv6')
  })
})

describe('ruleMatches and volumeOf', () => {
  it('matches the zones whatever the case, the protocol and, for TCP and UDP, the ports', () => {
    expect(ruleMatches({ src: 'WEB', dst: 'db', proto: 'tcp', dport: '5432' }, ROWS[0])).toBe(true)
    expect(ruleMatches({ src: 'web', dst: 'db', proto: 'tcp', dport: '22' }, ROWS[0])).toBe(false)
    expect(ruleMatches({ src: 'web', dst: 'app', proto: 'tcp', dport: '' }, ROWS[0])).toBe(false)
    expect(ruleMatches({ src: 'web', dst: 'db', proto: 'udp', dport: '' }, ROWS[0])).toBe(false)
    expect(ruleMatches({ src: 'web', dst: 'db', proto: 'any', dport: '' }, ROWS[2])).toBe(true)
    // An ICMP flow covers every ICMP packet, whatever its "ports".
    expect(ruleMatches({ src: 'web', dst: 'db', proto: 'icmp', dport: '8' }, ROWS[2])).toBe(true)
    // Null zones match any zone.
    expect(ruleMatches(tokenRule('tcp/443'), ROWS[3])).toBe(true)
  })

  it('sums the rows any rule matches, each row once', () => {
    const rules = [{ src: 'web', dst: 'db', proto: 'tcp', dport: '5432' }, { src: 'web', dst: 'db', proto: 'tcp', dport: '5000:6000' }]
    expect(volumeOf(ROWS, rules)).toEqual({ bytes: 1000, packets: 10 })
    expect(volumeOf(ROWS, [])).toEqual({ bytes: 0, packets: 0 })
  })

  it('reads a service token, between two zones or any', () => {
    expect(tokenRule('udp/53,123', 'db', '')).toEqual({ src: 'db', dst: '', proto: 'udp', dport: '53,123' })
    expect(tokenRule('icmp')).toEqual({ src: null, dst: null, proto: 'icmp', dport: '' })
    expect(volumeOf(ROWS, [tokenRule('udp/53', 'db', '')]).bytes).toBe(20)
  })
})

describe('flowRules', () => {
  it('turns flows and observed flows into rules by zone name, a CIDR or no zone as the addresses in no zone', () => {
    const seen = { src_zone_id: '', dst_zone_id: 'zweb', proto: 'tcp', dport: '443' } as MicrosegSuggestion
    const rules = flowRules([flow({}), flow({ src_zone_id: '', src_cidr: '10.0.0.0/8', dst_zone_id: 'zweb', dport: '22' }), flow({ src_zone_id: 'gone' })], [seen], zoneName)
    expect(rules).toEqual([
      { src: 'web', dst: 'db', proto: 'tcp', dport: '5432' },
      { src: '', dst: 'web', proto: 'tcp', dport: '22' },
      { src: '', dst: 'web', proto: 'tcp', dport: '443' },
    ])
  })

  it('leaves out a flow with no zone at either end, and an observed flow to a zone that is gone', () => {
    const outside = flow({ src_zone_id: '', src_cidr: '1.1.1.1/32', dst_zone_id: '', dst_cidr: '2.2.2.2/32' })
    const toGone = { src_zone_id: 'zweb', dst_zone_id: 'gone', proto: 'tcp', dport: '1' } as MicrosegSuggestion
    const noZone = { src_zone_id: '', dst_zone_id: '', proto: 'tcp', dport: '1' } as MicrosegSuggestion
    expect(flowRules([outside], [toGone, noZone], zoneName)).toEqual([])
  })
})

describe('totals', () => {
  it('sums every row, or the rows of one pair', () => {
    expect(totalOf(ROWS)).toEqual({ bytes: 1377, packets: 27 })
    expect(totalOf(ROWS, { src: 'WEB', dst: 'db' })).toEqual({ bytes: 1057, packets: 22 })
  })

  it('sums the rows per service, the largest first', () => {
    expect([...volumeByService(ROWS).entries()]).toEqual([
      ['tcp/5432', { bytes: 1000, packets: 10 }],
      ['tcp/443', { bytes: 300, packets: 3 }],
      ['tcp/9100', { bytes: 50, packets: 5 }],
      ['udp/53', { bytes: 20, packets: 2 }],
      ['icmp', { bytes: 7, packets: 7 }],
    ])
  })
})

describe('mergeVolume', () => {
  const answer = (to: string, covered: boolean, buckets: MicrosegVolumeBucket[]): MicrosegVolume => ({ step: 300, from: '2026-11-20T09:00:00Z', to, covered, buckets })

  it('adds up the clusters of a shared policy, covered when any is, in the window of the latest answer', () => {
    expect(mergeVolume([])).toBeNull()
    const one = answer('2026-11-20T10:00:00Z', false, [ROWS[0]])
    expect(mergeVolume([one])).toBe(one)
    const merged = mergeVolume([one, answer('2026-11-20T10:01:00Z', true, [ROWS[1]])])!
    expect(merged.covered).toBe(true)
    expect(merged.to).toBe('2026-11-20T10:01:00Z')
    expect(merged.buckets).toEqual([ROWS[0], ROWS[1]])
  })
})

describe('volumeLevel and volumeWindow', () => {
  it('lights the bars of a gauge on a log scale, one at least, none without volume', () => {
    expect(volumeLevel(0, 100)).toBe(0)
    expect(volumeLevel(10, 0)).toBe(0)
    expect(volumeLevel(1e9, 1e9)).toBe(VOLUME_LEVELS)
    expect(volumeLevel(1e3, 1e9)).toBe(2)
    expect(volumeLevel(1, 1e12)).toBe(1)
    expect(volumeLevel(2e9, 1e9)).toBe(VOLUME_LEVELS)
  })

  it('reads the period ending on the next minute, the last 24 hours when the map shows every period, 7 days when asked', () => {
    const now = Date.parse('2026-11-20T10:00:30Z')
    expect(volumeWindow(now, '1h')).toEqual({ from: '2026-11-20T09:01:00.000Z', to: '2026-11-20T10:01:00.000Z' })
    expect(volumeWindow(now, 'all')).toEqual({ from: '2026-11-19T10:01:00.000Z', to: '2026-11-20T10:01:00.000Z' })
    expect(volumeWindow(now, '7d')).toEqual({ from: '2026-11-13T10:01:00.000Z', to: '2026-11-20T10:01:00.000Z' })
    expect(volumePeriodOf('all')).toBe('24h')
    expect(volumePeriodOf('1h')).toBe('1h')
    expect(Date.parse(volumeWindow(now, '24h').to) - Date.parse(volumeWindow(now, '24h').from)).toBe(86_400_000)
  })
})

describe('volumeSeries and sharedEnd', () => {
  const at = (min: number) => new Date(Date.parse('2026-11-20T10:00:00Z') + min * 60_000).toISOString()
  const bucket = (min: number, port: number, bytes: number): MicrosegVolumeBucket => ({ at: at(min), src_zone: 'web', dst_zone: 'db', proto: 'tcp', port, bytes, packets: 1 })
  const rules = [{ src: 'web', dst: 'db', proto: 'tcp', dport: '5432' }]

  it('sums the bytes of the matching rows per step, zero where nothing was measured, out of the window left out', () => {
    const from = Date.parse('2026-11-20T10:00:00Z')
    const rows = [bucket(0, 5432, 10), bucket(3, 5432, 5), bucket(10, 5432, 7), bucket(10, 22, 1000), bucket(-5, 5432, 99), bucket(30, 5432, 99)]
    expect(volumeSeries(rows, rules, from, 5 * 60_000, 4)).toEqual([15, 0, 7, 0])
    expect(volumeSeries(rows, [], from, 5 * 60_000, 2)).toEqual([0, 0])
  })

  it('narrows a read to the zone every rule names on a side, none when they differ', () => {
    expect(sharedEnd(rules, 'src')).toBe('web')
    expect(sharedEnd([...rules, { src: '', dst: 'db', proto: 'tcp', dport: '22' }], 'src')).toBeUndefined()
    expect(sharedEnd([...rules, { src: '', dst: 'db', proto: 'tcp', dport: '22' }], 'dst')).toBe('db')
    expect(sharedEnd([{ src: null, dst: 'db', proto: 'tcp', dport: '22' }], 'src')).toBeUndefined()
  })
})

describe('the samples of a volume', () => {
  it('sums the samples of the rows that tell them, and reads a volume on a few of them as an estimate', () => {
    const sum = { bytes: 0, packets: 0 }
    addVolume(sum, { bytes: 10, packets: 1 })
    expect(sum).toEqual({ bytes: 10, packets: 1 })
    addVolume(sum, { bytes: 5, packets: 512, samples: 1 })
    addVolume(sum, { bytes: 5, packets: 512, samples: 2 })
    expect(sum).toEqual({ bytes: 20, packets: 1025, samples: 3 })
    expect(fewSamples(sum)).toBe(true)
    expect(fewSamples({ bytes: 1, packets: 1, samples: VOLUME_FEW_SAMPLES })).toBe(false)
    // Unknown when the samples are not told, and nothing to estimate without bytes.
    expect(fewSamples({ bytes: 1, packets: 1 })).toBe(false)
    expect(fewSamples({ bytes: 1, packets: 1, samples: 0 })).toBe(false)
    expect(fewSamples({ bytes: 0, packets: 0, samples: 2 })).toBe(false)
    expect(fewSamples(null)).toBe(false)
    const rules = [{ src: 'web', dst: 'db', proto: 'tcp', dport: '22' }]
    const rows = [{ at: 'x', src_zone: 'web', dst_zone: 'db', proto: 'tcp', port: 22, bytes: 39_936, packets: 512, samples: 1 }]
    expect(volumeOf(rows, rules)).toEqual({ bytes: 39_936, packets: 512, samples: 1 })
    expect(totalOf(rows)).toEqual({ bytes: 39_936, packets: 512, samples: 1 })
    // Every view writes a volume the same way.
    expect(volumeText({ bytes: 39_936, packets: 512, samples: 1 }, 1)).toBe('≈ 39 KiB')
    expect(volumeText({ bytes: 39_936, packets: 512, samples: 40 }, 1)).toBe('39 KiB')
    expect(volumeText({ bytes: 39_936, packets: 512 }, 0)).toBe('39 KiB')
  })
})
