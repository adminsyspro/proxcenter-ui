import { describe, it, expect } from 'vitest'

import {
  parseVlanTag,
  buildBridgeVlanMap,
  resolveEffectiveTag,
  foldEffectiveVlanTags,
  extractHostBridges,
  extractHostVlans,
  bridgeLabel,
  type HostNetIface,
} from './hostVlanMap'

// DRO34's cluster (discussion #389): traditional VLAN segmentation with one
// bridge per VLAN, each fed by a bond sub-interface. No per-NIC tags on guests.
const DRO34_IFACES: HostNetIface[] = [
  { iface: 'bond0', type: 'bond' },
  { iface: 'bond0.5', type: 'vlan' },
  { iface: 'bond0.10', type: 'vlan' },
  { iface: 'bond1', type: 'bond' },
  { iface: 'bond1.7', type: 'vlan' },
  { iface: 'vmbr0V5', type: 'bridge', bridge_ports: 'bond0.5', bridge_vlan_aware: 1 },
  { iface: 'vmbr0V10', type: 'bridge', bridge_ports: 'bond0.10', bridge_vlan_aware: 1 },
  { iface: 'vmbr1V7', type: 'bridge', bridge_ports: 'bond1.7', bridge_vlan_aware: 1 },
]

describe('parseVlanTag', () => {
  it('extracts the VLAN id from a bond sub-interface name', () => {
    expect(parseVlanTag('bond0.10')).toBe(10)
    expect(parseVlanTag('bond1.7')).toBe(7)
  })

  it('extracts the VLAN id from a physical NIC sub-interface name', () => {
    expect(parseVlanTag('eno1.100')).toBe(100)
    expect(parseVlanTag('enp3s0.4094')).toBe(4094)
  })

  it('returns null for a non-VLAN interface (no numeric suffix)', () => {
    expect(parseVlanTag('bond0')).toBeNull()
    expect(parseVlanTag('vmbr0')).toBeNull()
    expect(parseVlanTag('eno1')).toBeNull()
  })

  it('does not treat a bridge name with an embedded digit as a VLAN', () => {
    // vmbr0V10 is just a bridge name; the VLAN comes from its uplink, not the name
    expect(parseVlanTag('vmbr0V10')).toBeNull()
  })

  it('rejects VLAN ids outside the valid 1-4094 range', () => {
    expect(parseVlanTag('bond0.0')).toBeNull()
    expect(parseVlanTag('bond0.4095')).toBeNull()
    expect(parseVlanTag('bond0.9999')).toBeNull()
  })

  it('returns null for empty or non-string input', () => {
    expect(parseVlanTag('')).toBeNull()
    expect(parseVlanTag(undefined as unknown as string)).toBeNull()
  })
})

describe('buildBridgeVlanMap', () => {
  it("maps DRO34's per-VLAN bridges to their bond sub-interface VLAN", () => {
    const map = buildBridgeVlanMap(DRO34_IFACES)
    expect(map.get('vmbr0V5')).toBe(5)
    expect(map.get('vmbr0V10')).toBe(10)
    expect(map.get('vmbr1V7')).toBe(7)
    expect(map.size).toBe(3)
  })

  it('does not map a bridge whose uplink is a raw trunk (no sub-interface)', () => {
    // A genuinely VLAN-aware bridge trunking the whole bond carries many VLANs,
    // so untagged guests on it must stay Untagged.
    const map = buildBridgeVlanMap([
      { iface: 'bond0', type: 'bond' },
      { iface: 'vmbr0', type: 'bridge', bridge_ports: 'bond0', bridge_vlan_aware: 1 },
    ])
    expect(map.has('vmbr0')).toBe(false)
    expect(map.size).toBe(0)
  })

  it('maps a bridge when all uplink ports agree on the same VLAN', () => {
    const map = buildBridgeVlanMap([
      { iface: 'vmbr2', type: 'bridge', bridge_ports: 'bond0.30 bond1.30' },
    ])
    expect(map.get('vmbr2')).toBe(30)
  })

  it('does not map a bridge whose uplink ports disagree on the VLAN', () => {
    const map = buildBridgeVlanMap([
      { iface: 'vmbr3', type: 'bridge', bridge_ports: 'bond0.10 bond1.20' },
    ])
    expect(map.has('vmbr3')).toBe(false)
  })

  it('resolves the VLAN from an explicit vlan-id field when the name is opaque', () => {
    const map = buildBridgeVlanMap([
      { iface: 'vlanA', type: 'vlan', 'vlan-id': 42, 'vlan-raw-device': 'bond0' },
      { iface: 'vmbr4', type: 'bridge', bridge_ports: 'vlanA' },
    ])
    expect(map.get('vmbr4')).toBe(42)
  })

  it('handles OVS bridges via ovs_ports', () => {
    const map = buildBridgeVlanMap([
      { iface: 'vmbr5', type: 'OVSBridge', ovs_ports: 'bond0.55' },
    ])
    expect(map.get('vmbr5')).toBe(55)
  })

  it('ignores bridges with no ports and tolerates missing fields', () => {
    const map = buildBridgeVlanMap([
      { iface: 'vmbr6', type: 'bridge' },
      { iface: 'lo', type: 'loopback' },
    ])
    expect(map.size).toBe(0)
  })

  it('returns an empty map for empty or non-array input', () => {
    expect(buildBridgeVlanMap([]).size).toBe(0)
    expect(buildBridgeVlanMap(undefined as unknown as HostNetIface[]).size).toBe(0)
  })
})

describe('resolveEffectiveTag', () => {
  const map = buildBridgeVlanMap(DRO34_IFACES)

  it('returns the host bridge VLAN for an untagged guest NIC', () => {
    expect(resolveEffectiveTag(undefined, 'vmbr0V10', map)).toBe(10)
    expect(resolveEffectiveTag(undefined, 'vmbr1V7', map)).toBe(7)
  })

  it('prefers an explicit per-NIC tag over the host bridge VLAN', () => {
    // Double-tag is unusual, but an explicit NIC tag is the authoritative intent.
    expect(resolveEffectiveTag(99, 'vmbr0V10', map)).toBe(99)
  })

  it('returns the NIC tag when the bridge is unknown', () => {
    expect(resolveEffectiveTag(20, 'someOtherBridge', map)).toBe(20)
  })

  it('returns undefined for an untagged guest on an unmapped bridge', () => {
    expect(resolveEffectiveTag(undefined, 'vmbr0', map)).toBeUndefined()
    expect(resolveEffectiveTag(undefined, undefined, map)).toBeUndefined()
  })
})

describe('foldEffectiveVlanTags', () => {
  type Net = { bridge: string; tag?: number; effectiveTag?: number }

  it('folds the host-derived effectiveTag into tag for grouping', () => {
    const folded = foldEffectiveVlanTags<Net>([
      { bridge: 'vmbr0V10', effectiveTag: 10 },
      { bridge: 'vmbrX', tag: 200, effectiveTag: 200 },
    ])
    expect(folded[0].tag).toBe(10)
    expect(folded[1].tag).toBe(200)
  })

  it('leaves a genuinely untagged net without a tag', () => {
    const folded = foldEffectiveVlanTags<Net>([{ bridge: 'vmbr0' }])
    expect(folded[0].tag).toBeUndefined()
  })

  it('is null-safe', () => {
    expect(foldEffectiveVlanTags(undefined)).toEqual([])
  })
})

describe('extractHostBridges', () => {
  const IFACES: HostNetIface[] = [
    { iface: 'bond0', type: 'bond' },
    { iface: 'bond0.10', type: 'vlan' },
    { iface: 'vmbr0V10', type: 'bridge', bridge_ports: 'bond0.10', bridge_vlan_aware: 1 },
    { iface: 'vmbr0', type: 'bridge', bridge_ports: 'bond0', bridge_vlan_aware: 1 },
    { iface: 'ovs0', type: 'OVSBridge', ovs_ports: 'bond0.20' },
  ]
  const VLAN_MAP = buildBridgeVlanMap(IFACES)

  it('includes bridge and OVSBridge interfaces, excludes non-bridge types', () => {
    const result = extractHostBridges('pve1', IFACES, VLAN_MAP)
    const ifaces = result.map((b) => b.iface)
    expect(ifaces).toContain('vmbr0V10')
    expect(ifaces).toContain('vmbr0')
    expect(ifaces).toContain('ovs0')
    expect(ifaces).not.toContain('bond0')
    expect(ifaces).not.toContain('bond0.10')
  })

  it('stamps the correct node on every entry', () => {
    const result = extractHostBridges('mynode', IFACES, VLAN_MAP)
    expect(result.every((b) => b.node === 'mynode')).toBe(true)
  })

  it('maps bridge type correctly', () => {
    const result = extractHostBridges('pve1', IFACES, VLAN_MAP)
    const bridge = result.find((b) => b.iface === 'vmbr0')
    const ovs = result.find((b) => b.iface === 'ovs0')
    expect(bridge?.type).toBe('bridge')
    expect(ovs?.type).toBe('OVSBridge')
  })

  it('attaches the VLAN tag from the bridgeVlanMap', () => {
    const result = extractHostBridges('pve1', IFACES, VLAN_MAP)
    const tagged = result.find((b) => b.iface === 'vmbr0V10')
    expect(tagged?.tag).toBe(10)
  })

  it('leaves tag undefined for a bridge not in the vlan map', () => {
    const result = extractHostBridges('pve1', IFACES, VLAN_MAP)
    const untagged = result.find((b) => b.iface === 'vmbr0')
    expect(untagged?.tag).toBeUndefined()
  })

  it('sets vlanAware from bridge_vlan_aware truthy field', () => {
    const ifaces: HostNetIface[] = [
      { iface: 'vmbr0', type: 'bridge', bridge_ports: 'bond0', bridge_vlan_aware: 1 },
      { iface: 'vmbr1', type: 'bridge', bridge_ports: 'bond1', bridge_vlan_aware: 0 },
      { iface: 'vmbr2', type: 'bridge', bridge_ports: 'bond2' },
    ]
    const result = extractHostBridges('pve1', ifaces, new Map())
    expect(result.find((b) => b.iface === 'vmbr0')?.vlanAware).toBe(true)
    expect(result.find((b) => b.iface === 'vmbr1')?.vlanAware).toBe(false)
    expect(result.find((b) => b.iface === 'vmbr2')?.vlanAware).toBe(false)
  })

  it('omits ports field when bridge_ports is empty or absent', () => {
    const ifaces: HostNetIface[] = [
      { iface: 'vmbr0', type: 'bridge', bridge_ports: '' },
      { iface: 'vmbr1', type: 'bridge' },
    ]
    const result = extractHostBridges('pve1', ifaces, new Map())
    expect(result.find((b) => b.iface === 'vmbr0')?.ports).toBeUndefined()
    expect(result.find((b) => b.iface === 'vmbr1')?.ports).toBeUndefined()
  })

  it('sets ports from bridge_ports (trimmed) when present', () => {
    const ifaces: HostNetIface[] = [
      { iface: 'vmbr0', type: 'bridge', bridge_ports: '  bond0  ' },
    ]
    const result = extractHostBridges('pve1', ifaces, new Map())
    expect(result.find((b) => b.iface === 'vmbr0')?.ports).toBe('bond0')
  })

  it('prefers bridge_ports over ovs_ports for port field', () => {
    const ifaces: HostNetIface[] = [
      { iface: 'ovsBr', type: 'OVSBridge', ovs_ports: 'bond0.20' },
    ]
    const result = extractHostBridges('pve1', ifaces, new Map())
    expect(result.find((b) => b.iface === 'ovsBr')?.ports).toBe('bond0.20')
  })

  it('sets cidr when the iface carries a cidr field', () => {
    const ifaces: HostNetIface[] = [
      { iface: 'vmbr0', type: 'bridge', bridge_ports: 'bond0', cidr: '192.168.1.1/24' },
    ]
    const result = extractHostBridges('pve1', ifaces, new Map())
    expect(result.find((b) => b.iface === 'vmbr0')?.cidr).toBe('192.168.1.1/24')
  })

  it('sorts results by iface name', () => {
    const ifaces: HostNetIface[] = [
      { iface: 'vmbr2', type: 'bridge' },
      { iface: 'vmbr0', type: 'bridge' },
      { iface: 'vmbr1', type: 'bridge' },
    ]
    const result = extractHostBridges('pve1', ifaces, new Map())
    expect(result.map((b) => b.iface)).toEqual(['vmbr0', 'vmbr1', 'vmbr2'])
  })

  it('returns an empty array for empty input', () => {
    expect(extractHostBridges('pve1', [], new Map())).toEqual([])
  })

  it('is null-safe for non-array input', () => {
    expect(extractHostBridges('pve1', undefined as unknown as HostNetIface[], new Map())).toEqual([])
  })

  it('skips entries without a string iface field', () => {
    const ifaces: HostNetIface[] = [
      null as unknown as HostNetIface,
      { iface: 'vmbr0', type: 'bridge' },
      { iface: 42 as unknown as string, type: 'bridge' },
    ]
    const result = extractHostBridges('pve1', ifaces, new Map())
    expect(result.map((b) => b.iface)).toEqual(['vmbr0'])
  })
})

describe('extractHostVlans', () => {
  it('extracts VLAN sub-interfaces with ids parsed from bondX.N names', () => {
    // DRO34 layout: one bond sub-interface per VLAN. All must surface even
    // though no guest is attached (issue #542).
    const result = extractHostVlans('pve1', DRO34_IFACES)
    expect(result.map((v) => v.tag)).toEqual([5, 7, 10])
    expect(result.map((v) => v.iface)).toEqual(['bond0.5', 'bond1.7', 'bond0.10'])
  })

  it('excludes non-VLAN interfaces (bonds, bridges, physical NICs)', () => {
    const result = extractHostVlans('pve1', DRO34_IFACES)
    const ifaces = result.map((v) => v.iface)
    expect(ifaces).not.toContain('bond0')
    expect(ifaces).not.toContain('vmbr0V5')
  })

  it('resolves the VLAN id from an explicit vlan-id field over the name', () => {
    const result = extractHostVlans('pve1', [
      { iface: 'vlanA', type: 'vlan', 'vlan-id': 42, 'vlan-raw-device': 'bond0' },
    ])
    expect(result).toHaveLength(1)
    expect(result[0].tag).toBe(42)
    expect(result[0].iface).toBe('vlanA')
  })

  it('surfaces VLANs riding a vmbrX.N sub-interface (vlan-aware-bridge layout)', () => {
    // Many VLANs over few bridges: the topology in issue #542.
    const ifaces: HostNetIface[] = [
      { iface: 'vmbr0', type: 'bridge', bridge_ports: 'bond0', bridge_vlan_aware: 1 },
      { iface: 'vmbr0.10', type: 'vlan' },
      { iface: 'vmbr0.20', type: 'vlan' },
      { iface: 'vmbr0.30', type: 'vlan' },
    ]
    const result = extractHostVlans('pve1', ifaces)
    expect(result.map((v) => v.tag)).toEqual([10, 20, 30])
  })

  it('de-duplicates by VLAN id, keeping the first interface seen', () => {
    // Same VLAN over two uplinks collapses to a single VLAN entry.
    const ifaces: HostNetIface[] = [
      { iface: 'bond0.10', type: 'vlan' },
      { iface: 'bond1.10', type: 'vlan' },
    ]
    const result = extractHostVlans('pve1', ifaces)
    expect(result).toHaveLength(1)
    expect(result[0].tag).toBe(10)
    expect(result[0].iface).toBe('bond0.10')
  })

  it('skips VLAN interfaces whose id cannot be resolved', () => {
    const result = extractHostVlans('pve1', [
      { iface: 'opaqueVlan', type: 'vlan' },
    ])
    expect(result).toEqual([])
  })

  it('stamps the node and carries active/autostart/cidr', () => {
    const result = extractHostVlans('mynode', [
      { iface: 'bond0.10', type: 'vlan', active: 1, autostart: 1, cidr: '10.0.10.1/24' },
    ])
    expect(result[0]).toMatchObject({
      node: 'mynode',
      iface: 'bond0.10',
      tag: 10,
      active: true,
      autostart: true,
      cidr: '10.0.10.1/24',
    })
  })

  it('omits cidr when absent and defaults active/autostart to false', () => {
    const result = extractHostVlans('pve1', [{ iface: 'bond0.10', type: 'vlan' }])
    expect(result[0].cidr).toBeUndefined()
    expect(result[0].active).toBe(false)
    expect(result[0].autostart).toBe(false)
  })

  it('sorts results by VLAN id ascending', () => {
    const result = extractHostVlans('pve1', [
      { iface: 'bond0.30', type: 'vlan' },
      { iface: 'bond0.5', type: 'vlan' },
      { iface: 'bond0.100', type: 'vlan' },
    ])
    expect(result.map((v) => v.tag)).toEqual([5, 30, 100])
  })

  it('returns an empty array for empty or non-array input', () => {
    expect(extractHostVlans('pve1', [])).toEqual([])
    expect(extractHostVlans('pve1', undefined as unknown as HostNetIface[])).toEqual([])
  })

  it('skips entries without a string iface field', () => {
    const ifaces: HostNetIface[] = [
      null as unknown as HostNetIface,
      { iface: 42 as unknown as string, type: 'vlan' },
      { iface: 'bond0.10', type: 'vlan' },
    ]
    const result = extractHostVlans('pve1', ifaces)
    expect(result.map((v) => v.iface)).toEqual(['bond0.10'])
  })
})

describe('bridgeLabel', () => {
  it('returns the alias when present and non-empty', () => {
    expect(bridgeLabel({ v42fc503: 'Production LAN' }, 'v42fc503')).toBe('Production LAN')
  })

  it('returns the bridge name unchanged when no alias is present', () => {
    expect(bridgeLabel({ v42fc503: 'Production LAN' }, 'vmbr0')).toBe('vmbr0')
  })

  it('returns the bridge name when the alias map is undefined', () => {
    expect(bridgeLabel(undefined, 'vmbr0')).toBe('vmbr0')
  })

  it('returns the bridge name when the alias is an empty string', () => {
    expect(bridgeLabel({ v42fc503: '' }, 'v42fc503')).toBe('v42fc503')
  })
})
