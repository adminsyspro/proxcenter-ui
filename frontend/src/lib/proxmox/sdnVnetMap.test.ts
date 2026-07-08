import { describe, it, expect } from 'vitest'
import { buildSdnVnets, sdnSegmentLabel, type SdnVnetRaw, type SdnZoneRaw } from './sdnVnetMap'

// Live-cluster shape (zone zovhpvec / vnet v42fc503, VNI 10000).
const ZONES: SdnZoneRaw[] = [
  { zone: 'zovhpvec', type: 'vxlan', peers: '10.99.99.203,10.99.99.201,10.99.99.202' },
]
const VNETS: SdnVnetRaw[] = [
  { vnet: 'v42fc503', alias: 'lan', zone: 'zovhpvec', tag: 10000 },
]

describe('buildSdnVnets', () => {
  it('joins a vnet with its vxlan zone and keeps the VNI verbatim (> 4094)', () => {
    const [v] = buildSdnVnets(VNETS, ZONES)
    expect(v).toMatchObject({ vnet: 'v42fc503', alias: 'lan', zone: 'zovhpvec', zoneType: 'vxlan', tag: 10000 })
    expect(v.peers).toEqual(['10.99.99.203', '10.99.99.201', '10.99.99.202'])
  })

  it('coerces a numeric-string tag', () => {
    const [v] = buildSdnVnets([{ vnet: 'v1', zone: 'z', tag: '30' }], [{ zone: 'z', type: 'vlan' }])
    expect(v.tag).toBe(30)
  })

  it('rejects a non-numeric tag (no parseInt partial)', () => {
    const [v] = buildSdnVnets([{ vnet: 'v1', zone: 'z', tag: '10abc' }], [{ zone: 'z', type: 'vlan' }])
    expect(v.tag).toBeUndefined()
  })

  it('uses empty-string sentinels for a vnet whose zone is missing/unresolved', () => {
    const [v] = buildSdnVnets([{ vnet: 'v1', zone: 'ghost' }], [])
    expect(v.zone).toBe('ghost')
    expect(v.zoneType).toBe('')
  })

  it('defaults zone to "" when the vnet carries no zone', () => {
    const [v] = buildSdnVnets([{ vnet: 'v1' }], [])
    expect(v.zone).toBe('')
    expect(v.zoneType).toBe('')
  })

  it('accepts peers already provided as an array', () => {
    const [v] = buildSdnVnets([{ vnet: 'v1', zone: 'z', tag: 5 }], [{ zone: 'z', type: 'evpn', peers: ['a', 'b'] }])
    expect(v.peers).toEqual(['a', 'b'])
  })

  it('only attaches peers for vxlan/evpn zones', () => {
    const [v] = buildSdnVnets([{ vnet: 'v1', zone: 'z', tag: 5 }], [{ zone: 'z', type: 'vlan', peers: 'x' }])
    expect(v.peers).toBeUndefined()
  })

  it('sorts by alias||vnet and skips malformed entries', () => {
    const out = buildSdnVnets(
      [{ vnet: 'zzz' }, { vnet: 'aaa', alias: 'mmm' }, null as unknown as SdnVnetRaw, { vnet: 42 as unknown as string }],
      [],
    )
    expect(out.map((v) => v.vnet)).toEqual(['aaa', 'zzz'])
  })

  it('is null/array-safe', () => {
    expect(buildSdnVnets(undefined as unknown as SdnVnetRaw[], ZONES)).toEqual([])
    expect(buildSdnVnets(VNETS, undefined as unknown as SdnZoneRaw[])[0].zoneType).toBe('')
  })
})

describe('sdnSegmentLabel', () => {
  it('labels vxlan/evpn as VNI and vlan/qinq as VLAN', () => {
    expect(sdnSegmentLabel({ vnet: 'v', zone: 'z', zoneType: 'vxlan', tag: 10000 })).toBe('VNI 10000')
    expect(sdnSegmentLabel({ vnet: 'v', zone: 'z', zoneType: 'evpn', tag: 7 })).toBe('VNI 7')
    expect(sdnSegmentLabel({ vnet: 'v', zone: 'z', zoneType: 'vlan', tag: 100 })).toBe('VLAN 100')
    expect(sdnSegmentLabel({ vnet: 'v', zone: 'z', zoneType: 'qinq', tag: 100 })).toBe('VLAN 100')
  })
  it('returns "" for simple/unknown zones or a missing tag', () => {
    expect(sdnSegmentLabel({ vnet: 'v', zone: 'z', zoneType: 'simple' })).toBe('')
    expect(sdnSegmentLabel({ vnet: 'v', zone: '', zoneType: '' })).toBe('')
    expect(sdnSegmentLabel({ vnet: 'v', zone: 'z', zoneType: 'vxlan' })).toBe('')
  })
})
