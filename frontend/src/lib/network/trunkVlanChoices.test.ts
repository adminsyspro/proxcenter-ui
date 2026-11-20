import { describe, it, expect } from 'vitest'

import { bridgeAcceptsTrunks, trunkVlanChoices } from './trunkVlanChoices'

describe('bridgeAcceptsTrunks', () => {
  it('accepts an OVS bridge and a VLAN aware Linux bridge', () => {
    expect(bridgeAcceptsTrunks({ type: 'OVSBridge' })).toBe(true)
    expect(bridgeAcceptsTrunks({ type: 'bridge', bridge_vlan_aware: 1 })).toBe(true)
    expect(bridgeAcceptsTrunks({ type: 'bridge', bridge_vlan_aware: '1' })).toBe(true)
  })

  it('refuses a Linux bridge that is not VLAN aware, the way Proxmox VE refuses to start the guest', () => {
    expect(bridgeAcceptsTrunks({ type: 'bridge' })).toBe(false)
    expect(bridgeAcceptsTrunks({ type: 'bridge', bridge_vlan_aware: 0 })).toBe(false)
  })

  it('does not judge anything else', () => {
    expect(bridgeAcceptsTrunks({ type: 'eth' })).toBeUndefined()
  })
})

describe('trunkVlanChoices', () => {
  const ifaces = [
    { iface: 'vmbr9', type: 'bridge', bridge_vlan_aware: 1, bridge_vids: '2-4094' },
    { iface: 'vmbr0', type: 'bridge', bridge_vids: '10 20' },
    { iface: 'vmbr9.300', type: 'vlan', 'vlan-id': '300', 'vlan-raw-device': 'vmbr9' },
    { iface: 'vmbr9.301', type: 'vlan' },
    { iface: 'vmbr0.4000', type: 'vlan', 'vlan-id': '4000', 'vlan-raw-device': 'vmbr0' },
  ]
  const zones = [{ zone: 'zv9', type: 'vlan', bridge: 'vmbr9' }, { zone: 'zx', type: 'vxlan' }]
  const vnets = [
    { vnet: 'dmz', zone: 'zv9', tag: 200, alias: 'DMZ' },
    { vnet: 'lan', zone: 'zv9', tag: '210' },
    { vnet: 'vx1', zone: 'zx', tag: 5000 },
    { vnet: 'untagged', zone: 'zv9' },
  ]
  const pools = [
    { bridge: 'vmbr9', rangeStart: 100, rangeEnd: 199, vdcName: 'Acme vDC' },
    { bridge: 'vmbr9', rangeStart: 250, rangeEnd: 250, vdcName: null },
    { bridge: 'vmbr0', rangeStart: 500, rangeEnd: 510, vdcName: 'Other' },
  ]

  it('lists the VLANs of a VLAN aware bridge from every source, valid ones only', () => {
    expect(trunkVlanChoices('vmbr9', { ifaces, zones, vnets, pools })).toEqual([
      { value: '2-4094', source: 'bridge' },
      { value: '300', source: 'iface', label: 'vmbr9.300' },
      { value: '301', source: 'iface', label: 'vmbr9.301' },
      { value: '200', source: 'sdn', label: 'DMZ' },
      { value: '210', source: 'sdn', label: 'lan' },
      { value: '100-199', source: 'vdc', label: 'Acme vDC' },
      { value: '250', source: 'vdc' },
    ])
  })

  it('ignores the bridge-vids of a bridge that is not VLAN aware', () => {
    expect(trunkVlanChoices('vmbr0', { ifaces, zones, vnets, pools })).toEqual([
      { value: '4000', source: 'iface', label: 'vmbr0.4000' },
      { value: '500-510', source: 'vdc', label: 'Other' },
    ])
  })

  it('returns nothing for an unknown bridge or without sources', () => {
    expect(trunkVlanChoices('vmbr7', { ifaces, zones, vnets, pools })).toEqual([])
    expect(trunkVlanChoices('vmbr9', {})).toEqual([])
  })

  it('keeps one row per value and source', () => {
    const twice = [...pools, { bridge: 'vmbr9', rangeStart: 100, rangeEnd: 199, vdcName: 'Acme vDC' }]
    expect(trunkVlanChoices('vmbr9', { pools: twice })).toHaveLength(2)
  })
})
