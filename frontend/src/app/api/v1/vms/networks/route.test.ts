import { describe, expect, it } from 'vitest'

import { buildBridgeVlanMap } from '@/lib/proxmox/hostVlanMap'
import { buildSdnVnets } from '@/lib/proxmox/sdnVnetMap'
import { buildVnetIndex, resolveNicSegment } from '@/lib/proxmox/nicSegment'

import { parseNetKeys } from './route'

/**
 * Payloads captured verbatim from a PVE 9.2.2 cluster carrying two VLAN zones
 * and one VXLAN zone on the same bridge. They pin the field names the segment
 * resolution depends on: a zone names its kind in `type`, a VNet carries `tag`
 * and `alias`, and a guest NIC attached to a VNet has NO `tag=` at all.
 *
 * The `net*` keys are deliberately NOT in index order. PVE serializes a guest
 * config from a Perl hash, whose iteration order is randomized per process
 * (measured on perl 5.40: five reads of the same config gave five different
 * orders), so a caller that takes the head of the list as the primary NIC only
 * works if the parser restores the order.
 */
const VM_CONFIG = {
  net2: 'virtio=BC:24:11:00:00:03,bridge=vmbr0',
  name: 'Debian13',
  net4: 'virtio=BC:24:11:00:00:05,bridge=vmbr0,tag=99',
  boot: 'order=scsi0;net0',
  net0: 'virtio=BC:24:11:C0:F0:6F,bridge=tv1',
  net3: 'virtio=BC:24:11:00:00:04,bridge=tvx1',
  scsi0: 'CephStoragePool:vm-100-disk-0,iothread=1,size=20G',
  net1: 'virtio=BC:24:11:00:00:02,bridge=tv2',
}

const SDN_VNETS = [
  { alias: 'prod-lan', tag: 137, type: 'vnet', vnet: 'tv1', zone: 'tzvl1' },
  { alias: 'dmz', tag: 250, type: 'vnet', vnet: 'tv2', zone: 'tzvl2' },
  { alias: 'overlay', tag: 4242, type: 'vnet', vnet: 'tvx1', zone: 'tzvx1' },
]

const SDN_ZONES = [
  { bridge: 'vmbr0', nodes: 'pve1-dr,pve2-dr,pve3-dr', type: 'vlan', zone: 'tzvl1' },
  { bridge: 'vmbr0', nodes: 'pve1-dr,pve2-dr,pve3-dr', type: 'vlan', zone: 'tzvl2' },
  { peers: '10.42.0.111,10.42.0.112,10.42.0.113', type: 'vxlan', zone: 'tzvx1' },
]

const NODE_NETWORK = [
  { active: 1, bridge_ports: 'nic0', cidr: '10.42.0.112/24', iface: 'vmbr0', type: 'bridge' },
  { active: 1, iface: 'nic0', type: 'eth' },
]

describe('parseNetKeys on a real PVE 9.2.2 guest', () => {
  it('reads no VLAN tag at all from a VNet-backed NIC', () => {
    const nics = parseNetKeys(VM_CONFIG, 'qemu')

    expect(nics.map((n) => n.bridge)).toEqual(['tv1', 'tv2', 'vmbr0', 'tvx1', 'vmbr0'])
    expect(nics.slice(0, 4).every((n) => n.vlanTag === null)).toBe(true)
    expect(nics[4].vlanTag).toBe(99)
  })

  it('restores NIC index order whatever order PVE returned the keys in', () => {
    expect(parseNetKeys(VM_CONFIG, 'qemu').map((n) => n.iface)).toEqual([
      'net0',
      'net1',
      'net2',
      'net3',
      'net4',
    ])
  })

  it('puts net0 first for every permutation of the same config', () => {
    const keys = Object.keys(VM_CONFIG)

    for (let shift = 0; shift < keys.length; shift++) {
      const rotated: Record<string, unknown> = {}

      for (let i = 0; i < keys.length; i++) {
        const key = keys[(i + shift) % keys.length]

        rotated[key] = (VM_CONFIG as Record<string, unknown>)[key]
      }

      const nics = parseNetKeys(rotated, 'qemu')

      expect(nics[0].iface, `shift ${shift}`).toBe('net0')
      expect(nics[0].bridge, `shift ${shift}`).toBe('tv1')
    }
  })

  it('orders by numeric index, not lexicographically', () => {
    const many = { net10: 'virtio,bridge=vmbr10', net2: 'virtio,bridge=vmbr2', net0: 'virtio,bridge=vmbr0' }

    expect(parseNetKeys(many, 'qemu').map((n) => n.iface)).toEqual(['net0', 'net2', 'net10'])
  })
})

describe('segment resolution over the route payloads', () => {
  it('gives every NIC its real segment instead of one No VLAN bucket', () => {
    const vnetById = buildVnetIndex(buildSdnVnets(SDN_VNETS, SDN_ZONES))
    const bridgeVlanMap = buildBridgeVlanMap(NODE_NETWORK)

    const resolved = parseNetKeys(VM_CONFIG, 'qemu').map((nic) => {
      const segment = resolveNicSegment({ bridge: nic.bridge, tag: nic.vlanTag }, vnetById, bridgeVlanMap)

      return { key: segment.key, label: segment.label, vlan: segment.vlan, bridge: segment.bridgeLabel }
    })

    expect(resolved).toEqual([
      { key: 'vnet-tv1', label: 'VLAN 137', vlan: 137, bridge: 'prod-lan' },
      { key: 'vnet-tv2', label: 'VLAN 250', vlan: 250, bridge: 'dmz' },
      { key: 'no-vlan', label: 'No VLAN', vlan: null, bridge: 'vmbr0' },
      { key: 'vnet-tvx1', label: 'VNI 4242', vlan: null, bridge: 'overlay' },
      { key: 'vlan-99', label: 'VLAN 99', vlan: 99, bridge: 'vmbr0' },
    ])
  })

  it('would have bucketed four of the five NICs as No VLAN before the fix', () => {
    // The grouping this route fed until now: `vlanTag != null ? vlan-N : no-vlan`.
    const before = parseNetKeys(VM_CONFIG, 'qemu').map((n) => (n.vlanTag != null ? `vlan-${n.vlanTag}` : 'no-vlan'))

    expect(before).toEqual(['no-vlan', 'no-vlan', 'no-vlan', 'no-vlan', 'vlan-99'])
  })
})
