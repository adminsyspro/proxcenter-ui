import { describe, it, expect } from 'vitest'

import {
  parseVlanTag,
  buildBridgeVlanMap,
  resolveEffectiveTag,
  foldEffectiveVlanTags,
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
