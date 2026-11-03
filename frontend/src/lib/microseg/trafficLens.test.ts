import { describe, expect, it } from 'vitest'

import type { MicrosegFlow, MicrosegSuggestion, MicrosegZone } from './types'
import {
  EXTERNAL_KEY, GROUP_COLORS, OTHER_KEY, UNZONED_KEY, aggregateByGroup, buildResolver, canonicalRows, coveringFlow, flowDraftOf,
  groupColor, groupKeyOf, pairVerdict, portInSpec, protoOf, sourceZoneSlices, trafficDistribution, zoneKey, type LensPair,
} from './trafficLens'

const zone = (id: string, over: Partial<MicrosegZone> = {}): MicrosegZone => ({
  id, policy_id: 'p1', name: id, label: '', color: `#${id.padEnd(6, '0').slice(0, 6)}`, enforcement: 'guest', vnet_id: '',
  state: 'observe', isolate_members: false, observe_since: null, ...over,
})
const flow = (over: Partial<MicrosegFlow> = {}): MicrosegFlow => ({
  id: 'f1', policy_id: 'p1', src_zone_id: 'web', src_cidr: '', dst_zone_id: 'db', dst_cidr: '', proto: 'tcp', dport: '5432',
  comment: '', origin: 'manual', created_by: 'me', ...over,
})
const suggestion = (over: Partial<MicrosegSuggestion> = {}): MicrosegSuggestion => ({
  id: 's1', policy_id: 'p1', kind: 'would_block', src_key: 'k', src_ip: '10.0.0.1', src_zone_id: 'web', dst_ip: '10.0.0.2',
  dst_zone_id: 'db', proto: 'tcp', dport: '5432', hits: 3, first_seen: '2026-11-01T10:00:00Z', last_seen: '2026-11-02T10:00:00Z',
  status: 'pending', ...over,
})
const pair = (src: string, dst: string, over: Partial<LensPair> = {}): LensPair => ({
  src_ip: src, dst_ip: dst, bytes: 100, packets: 1, protocol: 'TCP', dst_port: 5432, ...over,
})

const ZONES = [zone('web'), zone('db'), zone('iso', { isolate_members: true })]
const GUESTS = [
  { vmid: 101, name: 'web-01', tags: ['zone-web'], ips: ['10.0.0.1/24'] },
  { vmid: 102, name: 'db-01', tags: ['Zone-DB'], ips: ['10.0.0.2'] },
  { vmid: 103, name: 'lab', tags: ['other'], ips: ['10.0.0.3'] },
  { vmid: 104, name: 'iso-a', tags: ['zone-iso'], ips: ['10.0.0.4'] },
  { vmid: 105, name: 'iso-b', tags: ['zone-iso'], ips: ['10.0.0.5'] },
  { vmid: 106, name: 'dhcp', tags: ['zone-web'], ips: [] },
]
const resolve = buildResolver(ZONES, 'zone-', GUESTS)

describe('buildResolver', () => {
  it('puts an address on its guest, then on the zone of its tag (prefix and case ignored)', () => {
    expect(resolve('10.0.0.1')).toMatchObject({ kind: 'zone', zone: { id: 'web' }, guest: 'web-01' })
    expect(resolve('10.0.0.2')).toMatchObject({ kind: 'zone', zone: { id: 'db' } })
    expect(resolve('10.0.0.3')).toEqual({ kind: 'unzoned', guest: 'lab' })
    expect(resolve('192.0.2.9')).toEqual({ kind: 'external' })
  })

  it('falls back on the VMID the pair was attributed to, unless two guests share it', () => {
    expect(resolve('10.9.9.9', 106)).toMatchObject({ kind: 'zone', zone: { id: 'web' }, guest: 'dhcp' })
    const twice = buildResolver(ZONES, 'zone-', [...GUESTS, { vmid: 106, name: 'clash', tags: [], ips: [] }])
    expect(twice('10.9.9.9', 106)).toEqual({ kind: 'external' })
  })

  it('compares the canonical form of an address', () => {
    const v6 = buildResolver(ZONES, 'zone-', [{ vmid: 1, name: 'v6', tags: ['zone-db'], ips: ['2001:DB8:0:0::1/64'] }])
    expect(v6('2001:db8::1')).toMatchObject({ kind: 'zone', zone: { id: 'db' } })
  })
})

describe('portInSpec and coveringFlow', () => {
  it('reads single ports, lists and ranges; an empty list is every port', () => {
    expect(portInSpec(22, '22')).toBe(true)
    expect(portInSpec(443, '80,443')).toBe(true)
    expect(portInSpec(8050, '8000:8080')).toBe(true)
    expect(portInSpec(9000, '8000:8080')).toBe(false)
    expect(portInSpec(1, '')).toBe(true)
  })

  it('needs the zones, the protocol and the port; any covers every protocol; CIDR flows do not count', () => {
    const flows = [flow()]
    expect(coveringFlow(flows, 'web', 'db', 'TCP', 5432)).toBe(flows[0])
    expect(coveringFlow(flows, 'db', 'web', 'TCP', 5432)).toBeUndefined()
    expect(coveringFlow(flows, 'web', 'db', 'UDP', 5432)).toBeUndefined()
    expect(coveringFlow(flows, 'web', 'db', 'TCP', 22)).toBeUndefined()
    expect(coveringFlow([flow({ proto: 'any', dport: '' })], 'web', 'db', 'GRE', 0)).toBeDefined()
    expect(coveringFlow([flow({ proto: 'icmp', dport: '' })], 'web', 'db', 'ICMP', 0)).toBeDefined()
    expect(coveringFlow([flow({ src_zone_id: '', src_cidr: '10.0.0.0/8' })], 'web', 'db', 'TCP', 5432)).toBeUndefined()
  })
})

describe('pairVerdict', () => {
  it('is allowed by a covering flow', () => {
    const v = pairVerdict(pair('10.0.0.1', '10.0.0.2'), resolve, [flow()], [])
    expect(v.status).toBe('allowed')
    expect(v.flow?.id).toBe('f1')
  })

  it('is allowed inside a zone, unless the zone isolates its members', () => {
    expect(pairVerdict(pair('10.0.0.1', '10.0.0.1'), resolve, [], [])).toMatchObject({ status: 'allowed', intraZone: true })
    expect(pairVerdict(pair('10.0.0.4', '10.0.0.5'), resolve, [], []).status).toBe('not_covered')
  })

  it('is blocked when a pending blocked suggestion matches, not covered otherwise (with the would-block one)', () => {
    const blocked = suggestion({ id: 'b1', kind: 'blocked' })
    expect(pairVerdict(pair('10.0.0.1', '10.0.0.2'), resolve, [], [blocked])).toMatchObject({ status: 'blocked', suggestion: { id: 'b1' } })
    const would = suggestion()
    expect(pairVerdict(pair('10.0.0.1', '10.0.0.2'), resolve, [], [would])).toMatchObject({ status: 'not_covered', suggestion: { id: 's1' } })
    const done = suggestion({ status: 'accepted' })
    expect(pairVerdict(pair('10.0.0.1', '10.0.0.2'), resolve, [], [done]).suggestion).toBeUndefined()
    const otherPort = suggestion({ dport: '22' })
    expect(pairVerdict(pair('10.0.0.1', '10.0.0.2'), resolve, [], [otherPort]).suggestion).toBeUndefined()
  })

  it('matches a suggestion without addresses on its zones', () => {
    const byZone = suggestion({ src_ip: '', dst_ip: '' })
    expect(pairVerdict(pair('10.0.0.1', '10.0.0.2'), resolve, [], [byZone]).suggestion?.id).toBe('s1')
  })

  it('is unknown when an end is in no zone', () => {
    expect(pairVerdict(pair('10.0.0.3', '10.0.0.2'), resolve, [flow()], []).status).toBe('unknown')
    expect(pairVerdict(pair('10.0.0.1', '192.0.2.1'), resolve, [], []).status).toBe('unknown')
  })
})

describe('aggregation and distribution', () => {
  const PAIRS = [
    pair('10.0.0.1', '10.0.0.2', { bytes: 400 }),
    pair('10.0.0.1', '10.0.0.2', { bytes: 100, src_ip: '10.9.9.9', src_vmid: 106 }),
    pair('10.0.0.1', '10.0.0.1', { bytes: 200 }),
    pair('10.0.0.3', '10.0.0.2', { bytes: 100 }),
    pair('10.0.0.2', '192.0.2.1', { bytes: 150, protocol: 'UDP', dst_port: 53 }),
    pair('198.51.100.7', '10.0.0.1', { bytes: 50, dst_port: 443 }),
  ]

  it('sums the pairs per group, protocol and port', () => {
    const groups = aggregateByGroup(PAIRS, resolve)
    expect(groups[0]).toMatchObject({ src_ip: zoneKey('web'), dst_ip: zoneKey('db'), bytes: 500, packets: 2 })
    expect(groups.map(g => `${g.src_ip}>${g.dst_ip}`)).toEqual([
      'zone:web>zone:db', 'zone:web>zone:web', 'zone:db>external', `${UNZONED_KEY}>zone:db`, `${EXTERNAL_KEY}>zone:web`,
    ])
  })

  it('splits the bytes inside a zone, between zones, to the outside and from an unknown source', () => {
    const d = trafficDistribution(PAIRS, resolve)
    expect(d.total).toBe(1000)
    expect(d.intra).toEqual({ bytes: 200, percent: 20 })
    expect(d.between).toEqual({ bytes: 600, percent: 60 })
    expect(d.toOutside).toEqual({ bytes: 150, percent: 15 })
    expect(d.fromUnknown).toEqual({ bytes: 50, percent: 5 })
    expect(trafficDistribution([], resolve).intra.percent).toBe(0)
  })

  it('slices the bytes per source zone, the rest beyond the limit in Other', () => {
    const slices = sourceZoneSlices(PAIRS, resolve)
    expect(slices.map(s => [s.key, s.bytes])).toEqual([[zoneKey('web'), 700], [zoneKey('db'), 150], [UNZONED_KEY, 100], [EXTERNAL_KEY, 50]])
    expect(slices[0].percent).toBe(70)
    expect(slices[0].zone?.id).toBe('web')
    const capped = sourceZoneSlices(PAIRS, resolve, 2)
    expect(capped.map(s => [s.key, s.bytes])).toEqual([[zoneKey('web'), 700], [zoneKey('db'), 150], [OTHER_KEY, 150]])
    expect(capped[2].percent).toBe(15)
  })
})

describe('colours, keys and the flow draft', () => {
  it('colours a zone with its colour and the other groups in grey', () => {
    const byId = new Map(ZONES.map(z => [z.id, z]))
    expect(groupColor(zoneKey('web'), byId)).toBe(ZONES[0].color)
    expect(groupColor(zoneKey('gone'), byId)).toBe(GROUP_COLORS.zone)
    expect(groupColor(UNZONED_KEY, byId)).toBe(GROUP_COLORS.unzoned)
    expect(groupColor(EXTERNAL_KEY, byId)).toBe(GROUP_COLORS.external)
    expect(groupColor(OTHER_KEY, byId)).toBe(GROUP_COLORS.other)
    expect(groupKeyOf({ kind: 'external' })).toBe(EXTERNAL_KEY)
  })

  it('prefills the zones and the service; ports only for TCP and UDP, any for an unknown protocol', () => {
    expect(flowDraftOf(pair('a', 'b'), 'web', 'db')).toEqual({ src_zone_id: 'web', dst_zone_id: 'db', proto: 'tcp', dport: '5432' })
    expect(flowDraftOf(pair('a', 'b', { protocol: 'ICMP', dst_port: 0 }), 'web', 'db').dport).toBe('')
    expect(flowDraftOf(pair('a', 'b', { protocol: 'GRE' }), 'web', 'db')).toMatchObject({ proto: 'any', dport: '' })
  })
})

describe('protocols and zone states', () => {
  it('names ICMPv6 one way, and an icmpv6 flow covers an ICMPv6 pair (not an ICMP one)', () => {
    expect(protoOf('ICMPv6')).toBe('icmpv6')
    expect(protoOf('ipv6-icmp')).toBe('icmpv6')
    const v6 = [flow({ proto: 'icmpv6', dport: '' })]
    expect(coveringFlow(v6, 'web', 'db', 'ICMPv6', 0)).toBeDefined()
    expect(coveringFlow(v6, 'web', 'db', 'IPV6-ICMP', 0)).toBeDefined()
    expect(coveringFlow(v6, 'web', 'db', 'ICMP', 0)).toBeUndefined()
    expect(flowDraftOf(pair('a', 'b', { protocol: 'ICMPv6', dst_port: 0 }), 'web', 'db')).toMatchObject({ proto: 'icmpv6', dport: '' })
  })

  it('reads a pair into a disabled zone as unknown, not enforced; a source zone that is disabled does not matter', () => {
    const zones = [zone('web', { state: 'disabled' }), zone('db', { state: 'disabled' })]
    const r = buildResolver(zones, 'zone-', GUESTS)
    expect(pairVerdict(pair('10.0.0.1', '10.0.0.2'), r, [flow()], [])).toMatchObject({ status: 'unknown', notEnforced: true })
    const srcOff = buildResolver([zone('web', { state: 'disabled' }), zone('db')], 'zone-', GUESTS)
    expect(pairVerdict(pair('10.0.0.1', '10.0.0.2'), srcOff, [flow()], []).status).toBe('allowed')
  })
})

describe('canonicalRows: the reply direction of a pair', () => {
  // web-01 (10.0.0.1) opens tcp/5432 to db-01 (10.0.0.2): the answers carry the client port.
  const covered = (p: LensPair) => pairVerdict(p, resolve, [flow()], []).status === 'allowed'

  it('folds a reply on a client port into its request: bytes summed, no row of its own', () => {
    const rows = canonicalRows([
      pair('10.0.0.1', '10.0.0.2', { bytes: 300, packets: 3 }),
      pair('10.0.0.2', '10.0.0.1', { dst_port: 51234, bytes: 700, packets: 7 }),
    ], covered)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ src_ip: '10.0.0.1', dst_port: 5432, bytes: 1000, packets: 10, replyBytes: 700, orphanReply: false })
    expect(pairVerdict(rows[0], resolve, [flow()], []).status).toBe('allowed')
  })

  it('folds the reply whichever direction is listed first', () => {
    const rows = canonicalRows([
      pair('10.0.0.2', '10.0.0.1', { dst_port: 40000, bytes: 50 }),
      pair('10.0.0.1', '10.0.0.2', { bytes: 10 }),
    ], () => false)
    expect(rows.map(r => [r.src_ip, r.dst_port, r.bytes])).toEqual([['10.0.0.1', 5432, 60]])
  })

  it('marks a direction alone on a client port that no flow covers as return traffic, without action', () => {
    const [row] = canonicalRows([pair('10.0.0.2', '10.0.0.1', { dst_port: 51234 })], covered)
    expect(row).toMatchObject({ orphanReply: true, replyBytes: 0 })
    expect(pairVerdict(row, resolve, [flow()], []).status).toBe('reply')
    const [served] = canonicalRows([pair('10.0.0.2', '10.0.0.1', { dst_port: 51234 })], () => true)
    expect(served.orphanReply).toBe(false)
    const [serviceAlone] = canonicalRows([pair('10.0.0.2', '10.0.0.1', { dst_port: 5432 })], covered)
    expect(serviceAlone.orphanReply).toBe(false)
  })

  it('keeps two service ports as two rows with their own status: B may have opened a service of its own toward A', () => {
    const rows = canonicalRows([pair('10.0.0.1', '10.0.0.2', { bytes: 200 }), pair('10.0.0.2', '10.0.0.1', { dst_port: 8443, bytes: 100 })], covered)
    expect(rows.map(r => [r.src_ip, r.dst_port, r.replyBytes, r.orphanReply])).toEqual([['10.0.0.1', 5432, 0, false], ['10.0.0.2', 8443, 0, false]])
    expect(rows.map(r => pairVerdict(r, resolve, [flow()], []).status)).toEqual(['allowed', 'not_covered'])
  })

  it('of two client ports folds the higher one, and keeps other protocols and addresses apart', () => {
    const rows = canonicalRows([
      pair('10.0.0.1', '10.0.0.2', { dst_port: 33000, bytes: 10 }),
      pair('10.0.0.2', '10.0.0.1', { dst_port: 60000, bytes: 10 }),
      pair('10.0.0.2', '10.0.0.1', { protocol: 'UDP', dst_port: 53, bytes: 5 }),
      pair('10.0.0.3', '10.0.0.1', { dst_port: 443, bytes: 1 }),
    ], () => false)
    expect(rows.map(r => `${r.src_ip}>${r.dst_ip}:${r.protocol}/${r.dst_port}=${r.bytes}`)).toEqual([
      '10.0.0.1>10.0.0.2:TCP/33000=20', '10.0.0.2>10.0.0.1:UDP/53=5', '10.0.0.3>10.0.0.1:TCP/443=1',
    ])
  })
})
