import { describe, expect, it } from 'vitest'

import { buildVnetIndex, resolveNicSegment } from '@/lib/proxmox/nicSegment'
import { buildSdnVnets } from '@/lib/proxmox/sdnVnetMap'

import { buildTopologyGraph } from './buildTopologyGraph'
import type { InventoryData, TopologyFilters, VlanContainerNodeData, VlanGroupNodeData } from '../types'
import type { NetworkMap, VmNetworkInfo } from '../hooks/useTopologyNetworks'

const CONN = 'cmtk6kkex000d7zjlt3abo6e4'

/** Inventory with two guests on pve1, as /api/v1/inventory returns it. */
const inventory: InventoryData = {
  clusters: [
    {
      id: CONN,
      name: 'PVE-PROD',
      type: 'pve',
      isCluster: true,
      status: 'online',
      nodes: [
        {
          node: 'pve1',
          status: 'online',
          cpu: 0.1,
          maxcpu: 8,
          mem: 4_000_000_000,
          maxmem: 16_000_000_000,
          uptime: 1000,
          guests: [
            { vmid: 100, name: 'Debian13', status: 'running', type: 'qemu', node: 'pve1' },
            { vmid: 101, name: 'ct-web', status: 'running', type: 'lxc', node: 'pve1' },
          ],
        },
      ],
    },
  ],
}

/** The VNet/zone pair a VLAN zone produces, resolved as the route does. */
const vnetById = buildVnetIndex(
  buildSdnVnets(
    [
      { vnet: 'tv1', alias: 'prod', zone: 'tzvl1', tag: 137 },
      { vnet: 'v42fc503', alias: 'lan', zone: 'zvx', tag: 4242 },
    ],
    [
      { zone: 'tzvl1', type: 'vlan', bridge: 'vmbr0' },
      { zone: 'zvx', type: 'vxlan' },
    ],
  ),
)

/** A NIC of the payload, with its segment resolved server-side. */
function nic(bridge: string, tag: number | null, ip: string | null = null, cidr: number | null = null): VmNetworkInfo {
  return {
    bridge,
    vlanTag: tag,
    ip,
    cidr,
    segment: resolveNicSegment({ bridge, tag }, vnetById, new Map([['vmbr1', 30]])),
  }
}

function networkMap(entries: Array<[string, VmNetworkInfo[]]>): NetworkMap {
  return new Map(entries)
}

const qemuKey = `${CONN}:qemu:pve1:100`
const lxcKey = `${CONN}:lxc:pve1:101`

const networkFilters: TopologyFilters = { vmThreshold: 20, viewMode: 'network' }
const infraFilters: TopologyFilters = { vmThreshold: 20, viewMode: 'infra', groupByVlan: true }

function containers(data: InventoryData, map: NetworkMap): VlanContainerNodeData[] {
  return buildTopologyGraph(data, networkFilters, map)
    .nodes.filter((n) => n.type === 'vlanContainer')
    .map((n) => n.data as unknown as VlanContainerNodeData)
}

function groups(data: InventoryData, map: NetworkMap): VlanGroupNodeData[] {
  return buildTopologyGraph(data, infraFilters, map)
    .nodes.filter((n) => n.type === 'vlanGroup')
    .map((n) => n.data as unknown as VlanGroupNodeData)
}

describe('buildTopologyGraph network view', () => {
  it('buckets a VLAN-zone VNet guest on its VLAN instead of No VLAN', () => {
    const found = containers(
      inventory,
      networkMap([
        [qemuKey, [nic('tv1', null)]],
        [lxcKey, [nic('tv1', null)]],
      ]),
    )

    expect(found).toHaveLength(1)
    expect(found[0].segmentKey).toBe('vnet-tv1')
    expect(found[0].label).toBe('VLAN 137')
    expect(found[0].vlanTag).toBe(137)
    expect(found[0].bridge).toBe('prod')
    expect(found[0].vnet).toBe('tv1')
    expect(found[0].zone).toBe('tzvl1')
    expect(found[0].zoneType).toBe('vlan')
    expect(found[0].vms.map((v) => v.vmid)).toEqual([100, 101])
  })

  it('labels a VXLAN VNet guest with its VNI and reports no VLAN id', () => {
    const found = containers(
      inventory,
      networkMap([
        [qemuKey, [nic('v42fc503', null)]],
        [lxcKey, [nic('v42fc503', null)]],
      ]),
    )

    expect(found).toHaveLength(1)
    expect(found[0].segmentKey).toBe('vnet-v42fc503')
    expect(found[0].label).toBe('VNI 4242')
    expect(found[0].segmentTag).toBe(4242)
    expect(found[0].vlanTag).toBeNull()
    expect(found[0].bridge).toBe('lan')
  })

  it('keeps a VNet bucket and a same-tag per-NIC bucket apart', () => {
    const found = containers(
      inventory,
      networkMap([
        [qemuKey, [nic('tv1', null)]],
        [lxcKey, [nic('vmbr0', 137)]],
      ]),
    )

    expect(found.map((c) => c.segmentKey).sort()).toEqual(['vlan-137', 'vnet-tv1'])
    expect(found.every((c) => c.vlanTag === 137)).toBe(true)
  })

  it('resolves the traditional bondX.N bridge instead of No VLAN', () => {
    const found = containers(
      inventory,
      networkMap([
        [qemuKey, [nic('vmbr1', null)]],
        [lxcKey, [nic('vmbr1', null)]],
      ]),
    )

    expect(found).toHaveLength(1)
    expect(found[0].segmentKey).toBe('vlan-30')
    expect(found[0].label).toBe('VLAN 30')
    expect(found[0].bridge).toBe('vmbr1')
    expect(found[0].vnet).toBeUndefined()
  })

  it('still buckets a genuinely untagged guest under No VLAN', () => {
    const found = containers(
      inventory,
      networkMap([
        [qemuKey, [nic('vmbr0', null)]],
        [lxcKey, [nic('vmbr0', null)]],
      ]),
    )

    expect(found).toHaveLength(1)
    expect(found[0].segmentKey).toBe('no-vlan')
    expect(found[0].vlanTag).toBeNull()
    expect(found[0].segmentTag).toBeNull()
    expect(found[0].bridge).toBe('vmbr0')
  })

  it('buckets a guest with no readable NIC under No VLAN with an unknown bridge', () => {
    const found = containers(inventory, networkMap([[qemuKey, []], [lxcKey, []]]))

    expect(found).toHaveLength(1)
    expect(found[0].segmentKey).toBe('no-vlan')
    expect(found[0].bridge).toBe('unknown')
  })

  it('still derives the subnet from a guest IP inside a VNet bucket', () => {
    const found = containers(
      inventory,
      networkMap([
        [qemuKey, [nic('tv1', null, '10.42.0.37', 24)]],
        [lxcKey, [nic('tv1', null, '10.42.0.38', 24)]],
      ]),
    )

    expect(found).toHaveLength(1)
    expect(found[0].subnet).toBe('10.42.0.0/24')
  })

  it('emits one container per segment when a guest has several NICs', () => {
    const found = containers(
      inventory,
      networkMap([
        [qemuKey, [nic('tv1', null), nic('vmbr0', 50)]],
        [lxcKey, [nic('tv1', null)]],
      ]),
    )

    expect(found.map((c) => c.segmentKey).sort()).toEqual(['vlan-50', 'vnet-tv1'])
  })
})

describe('buildTopologyGraph infra view grouped by VLAN', () => {
  it('groups a VNet guest under its VNet rather than No VLAN', () => {
    const found = groups(
      inventory,
      networkMap([
        [qemuKey, [nic('tv1', null)]],
        [lxcKey, [nic('tv1', null)]],
      ]),
    )

    expect(found).toHaveLength(1)
    expect(found[0].segmentKey).toBe('vnet-tv1')
    expect(found[0].label).toBe('VLAN 137')
    expect(found[0].bridge).toBe('prod')
    expect(found[0].vmCount).toBe(2)
  })

  it('splits a VNet guest from an untagged one on the same node', () => {
    const found = groups(
      inventory,
      networkMap([
        [qemuKey, [nic('v42fc503', null)]],
        [lxcKey, [nic('vmbr0', null)]],
      ]),
    )

    expect(found.map((g) => g.segmentKey).sort()).toEqual(['no-vlan', 'vnet-v42fc503'])
  })

  it('groups on the primary NIC when a guest has several', () => {
    const found = groups(
      inventory,
      networkMap([
        [qemuKey, [nic('tv1', null), nic('vmbr0', 50)]],
        [lxcKey, [nic('tv1', null)]],
      ]),
    )

    expect(found).toHaveLength(1)
    expect(found[0].segmentKey).toBe('vnet-tv1')
  })
})
