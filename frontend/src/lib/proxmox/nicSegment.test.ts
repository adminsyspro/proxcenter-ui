import { describe, expect, it } from 'vitest'

import { buildSdnVnets, type SdnVnet } from './sdnVnetMap'
import { buildVnetIndex, NO_SEGMENT_KEY, resolveNicSegment } from './nicSegment'

/** Build the vnet index the way the route does: raw PVE payloads, then joined. */
function indexOf(vnets: any[], zones: any[]): Map<string, SdnVnet> {
  return buildVnetIndex(buildSdnVnets(vnets, zones))
}

const noVnets = new Map<string, SdnVnet>()
const noBridges = new Map<string, number>()

describe('resolveNicSegment', () => {
  it('resolves a VLAN-zone VNet to its VLAN id, which the NIC never carries', () => {
    const byId = indexOf(
      [{ vnet: 'tv1', alias: 'prod', zone: 'tzvl1', tag: 137 }],
      [{ zone: 'tzvl1', type: 'vlan', bridge: 'vmbr0' }],
    )

    const segment = resolveNicSegment({ bridge: 'tv1' }, byId, noBridges)

    expect(segment.key).toBe('vnet-tv1')
    expect(segment.label).toBe('VLAN 137')
    expect(segment.vlan).toBe(137)
    expect(segment.tag).toBe(137)
    expect(segment.bridgeLabel).toBe('prod')
    expect(segment.vnet).toBe('tv1')
    expect(segment.zone).toBe('tzvl1')
    expect(segment.zoneType).toBe('vlan')
  })

  it('labels a VXLAN-zone VNet as a VNI and reports no 802.1Q VLAN', () => {
    const byId = indexOf(
      [{ vnet: 'v42fc503', alias: 'lan', zone: 'zvx', tag: 4242 }],
      [{ zone: 'zvx', type: 'vxlan', peers: '10.42.0.101,10.42.0.102' }],
    )

    const segment = resolveNicSegment({ bridge: 'v42fc503' }, byId, noBridges)

    expect(segment.key).toBe('vnet-v42fc503')
    expect(segment.label).toBe('VNI 4242')
    expect(segment.vlan).toBeNull()
    expect(segment.tag).toBe(4242)
  })

  it('treats a QinQ zone as a VLAN zone', () => {
    const byId = indexOf(
      [{ vnet: 'tvq', zone: 'zq', tag: 300 }],
      [{ zone: 'zq', type: 'qinq' }],
    )

    expect(resolveNicSegment({ bridge: 'tvq' }, byId, noBridges).vlan).toBe(300)
  })

  it('falls back to the VNet name when the zone type names no segment', () => {
    const byId = indexOf(
      [{ vnet: 'vsimple', alias: 'flat', zone: 'zs' }],
      [{ zone: 'zs', type: 'simple' }],
    )

    const segment = resolveNicSegment({ bridge: 'vsimple' }, byId, noBridges)

    expect(segment.key).toBe('vnet-vsimple')
    expect(segment.label).toBe('flat')
    expect(segment.vlan).toBeNull()
    expect(segment.tag).toBeNull()
  })

  it('uses the raw VNet id as the label when the VNet has no alias', () => {
    const byId = indexOf([{ vnet: 'v42fc503', zone: 'zs' }], [{ zone: 'zs', type: 'simple' }])

    const segment = resolveNicSegment({ bridge: 'v42fc503' }, byId, noBridges)

    expect(segment.label).toBe('v42fc503')
    expect(segment.bridgeLabel).toBe('v42fc503')
  })

  it('keys two same-tag VNets of different zones apart, as PVE allows them', () => {
    // Measured on the lab: `tv1 tag=137 zone=tzvl1` and `tv2 tag=137 zone=tzvl2`
    // are both accepted on vmbr0. Grouping by tag would fuse two isolated L2s.
    const byId = indexOf(
      [
        { vnet: 'tv1', zone: 'tzvl1', tag: 137 },
        { vnet: 'tv2', zone: 'tzvl2', tag: 137 },
      ],
      [
        { zone: 'tzvl1', type: 'vlan', bridge: 'vmbr0' },
        { zone: 'tzvl2', type: 'vlan', bridge: 'vmbr0' },
      ],
    )

    const a = resolveNicSegment({ bridge: 'tv1' }, byId, noBridges)
    const b = resolveNicSegment({ bridge: 'tv2' }, byId, noBridges)

    expect(a.key).not.toBe(b.key)
    expect(a.label).toBe(b.label)
  })

  it('lets the VNet win over a per-NIC tag on the same NIC', () => {
    const byId = indexOf(
      [{ vnet: 'tv1', zone: 'tzvl1', tag: 137 }],
      [{ zone: 'tzvl1', type: 'vlan' }],
    )

    const segment = resolveNicSegment({ bridge: 'tv1', tag: 99 }, byId, noBridges)

    expect(segment.key).toBe('vnet-tv1')
    expect(segment.vlan).toBe(137)
  })

  it('keeps the per-NIC tag on a VLAN-aware bridge', () => {
    const segment = resolveNicSegment({ bridge: 'vmbr0', tag: 137 }, noVnets, noBridges)

    expect(segment.key).toBe('vlan-137')
    expect(segment.label).toBe('VLAN 137')
    expect(segment.vlan).toBe(137)
    expect(segment.bridgeLabel).toBe('vmbr0')
    expect(segment.vnet).toBeUndefined()
  })

  it('resolves the traditional bondX.N layout from the host bridge map', () => {
    const bridges = new Map<string, number>([['vmbr1', 30]])

    const segment = resolveNicSegment({ bridge: 'vmbr1' }, noVnets, bridges)

    expect(segment.key).toBe('vlan-30')
    expect(segment.vlan).toBe(30)
    expect(segment.bridgeLabel).toBe('vmbr1')
  })

  it('prefers the per-NIC tag over the host bridge VLAN', () => {
    const bridges = new Map<string, number>([['vmbr1', 30]])

    expect(resolveNicSegment({ bridge: 'vmbr1', tag: 137 }, noVnets, bridges).vlan).toBe(137)
  })

  it('ignores a non-VLAN tag value so the host bridge fallback still applies', () => {
    const bridges = new Map<string, number>([['vmbr1', 30]])

    expect(resolveNicSegment({ bridge: 'vmbr1', tag: 0 }, noVnets, bridges).vlan).toBe(30)
    expect(resolveNicSegment({ bridge: 'vmbr0', tag: 0 }, noVnets, noBridges).key).toBe(NO_SEGMENT_KEY)
  })

  it('reports no segment for a plain untagged bridge', () => {
    const segment = resolveNicSegment({ bridge: 'vmbr0' }, noVnets, noBridges)

    expect(segment.key).toBe(NO_SEGMENT_KEY)
    expect(segment.label).toBe('No VLAN')
    expect(segment.vlan).toBeNull()
    expect(segment.bridgeLabel).toBe('vmbr0')
  })

  it('degrades to the per-NIC tag when SDN is out of scope or unavailable', () => {
    // Tenant scope ships no VNets, exactly like the inventory Network view.
    const onVnet = resolveNicSegment({ bridge: 'v42fc503' }, noVnets, noBridges)

    expect(onVnet.key).toBe(NO_SEGMENT_KEY)
    expect(onVnet.bridgeLabel).toBe('v42fc503')

    expect(resolveNicSegment({ bridge: 'vmbr0', tag: 137 }, noVnets, noBridges).key).toBe('vlan-137')
  })

  it('labels a missing bridge rather than emitting an empty string', () => {
    expect(resolveNicSegment({}, noVnets, noBridges).bridgeLabel).toBe('unknown')
    expect(resolveNicSegment({ bridge: null }, noVnets, noBridges).bridgeLabel).toBe('unknown')
  })
})

describe('buildVnetIndex', () => {
  it('indexes VNets by id and is null-safe', () => {
    expect(buildVnetIndex(undefined).size).toBe(0)
    expect(buildVnetIndex(null).size).toBe(0)
    expect(buildVnetIndex([]).size).toBe(0)

    const byId = buildVnetIndex([
      { vnet: 'a', zone: 'z', zoneType: 'vlan', tag: 10 },
      { vnet: '', zone: 'z', zoneType: 'vlan' },
    ] as SdnVnet[])

    expect(byId.size).toBe(1)
    expect(byId.get('a')?.tag).toBe(10)
  })
})
