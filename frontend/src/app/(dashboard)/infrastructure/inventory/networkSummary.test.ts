import { describe, expect, it } from 'vitest'

import { buildNetworkSummary, guestKey, type VmNetData } from './networkSummary'

const vm = (over: Partial<VmNetData>): VmNetData => ({
  vmid: '100', name: 'web', node: 'pve1', type: 'qemu', status: 'running', connId: 'c1', nets: [], ...over,
})

const LAN = { connId: 'c1', vnet: 'v6bc065f', alias: 'lan', zone: 'zmsp', zoneType: 'vxlan', tag: 10000 } as any

const build = (over: Partial<Parameters<typeof buildNetworkSummary>[0]> = {}) =>
  buildNetworkSummary({ networkData: [], hostBridges: [], hostVlans: [], sdnVnets: [], connectionNames: { c1: 'PVE-PROD' }, ...over })

describe('buildNetworkSummary (#1290)', () => {
  it('lists the guests of a VNet across every node of its cluster, sorted by name', () => {
    const summary = build({
      sdnVnets: [LAN],
      networkData: [
        vm({ vmid: '107', name: 'Rocky-vDC', node: 'pve2', nets: [{ id: 'net0', bridge: 'v6bc065f' }] }),
        vm({ vmid: '106', name: 'Debian-vDC', node: 'pve3', nets: [{ id: 'net0', bridge: 'v6bc065f' }] }),
      ],
    })

    expect(summary.totalVnets).toBe(1)
    const [lan] = summary.vnetBreakdown
    expect(lan.vmCount).toBe(2)
    expect(lan.guests.map(g => [g.name, g.node, g.key])).toEqual([
      ['Debian-vDC', 'pve3', 'c1:pve3:qemu:106'],
      ['Rocky-vDC', 'pve2', 'c1:pve2:qemu:107'],
    ])
    // A VNet-backed interface is neither a host bridge nor a VLAN bucket.
    expect(summary.bridgeBreakdown).toEqual([])
    expect(summary.vlanBreakdown).toEqual([])
  })

  it('counts a guest with two interfaces on the same network once, with both interfaces', () => {
    const summary = build({
      sdnVnets: [LAN],
      networkData: [
        vm({ nets: [{ id: 'net0', bridge: 'vmbr0', tag: 100 }, { id: 'net1', bridge: 'vmbr0', tag: 100 }, { id: 'net2', bridge: 'v6bc065f' }, { id: 'net3', bridge: 'v6bc065f' }] }),
      ],
    })

    expect(summary.bridgeBreakdown[0]).toMatchObject({ bridge: 'vmbr0', vmCount: 1 })
    expect(summary.bridgeBreakdown[0].guests[0].ifaces).toEqual(['net0', 'net1'])
    expect(summary.vlanBreakdown[0]).toMatchObject({ vlan: 100, vmCount: 1, bridges: ['vmbr0'] })
    expect(summary.vnetBreakdown[0].vmCount).toBe(1)
    expect(summary.vnetBreakdown[0].guests[0].ifaces).toEqual(['net2', 'net3'])
    expect(summary.totalVmsWithNetwork).toBe(1)
  })

  it('keeps the same VNet id of two connections apart', () => {
    const summary = build({
      sdnVnets: [LAN, { ...LAN, connId: 'c2' }],
      networkData: [
        vm({ connId: 'c1', nets: [{ id: 'net0', bridge: 'v6bc065f' }] }),
        vm({ connId: 'c2', vmid: '200', nets: [{ id: 'net0', bridge: 'v6bc065f' }] }),
      ],
    })

    expect(summary.vnetBreakdown.map(v => v.guests.map(g => g.vmid))).toEqual([['100'], ['200']])
  })

  it('seeds bridges and VLANs from the hosts with no guest', () => {
    const summary = build({
      hostBridges: [
        { connId: 'c1', node: 'pve1', iface: 'vmbr1', type: 'OVSBridge', tag: 20 } as any,
        { connId: 'c9', node: 'pve9', iface: 'vmbr0', type: 'bridge' } as any,
      ],
      hostVlans: [{ connId: 'c1', node: 'pve1', tag: 30 } as any],
    })

    expect(summary.bridgeBreakdown).toEqual([
      { key: 'c1:pve1:vmbr1', bridge: 'vmbr1', node: 'pve1', connId: 'c1', connName: 'PVE-PROD', type: 'ovs_bridge', vmCount: 0, guests: [] },
      // No name known for the connection: its id stands in.
      { key: 'c9:pve9:vmbr0', bridge: 'vmbr0', node: 'pve9', connId: 'c9', connName: 'c9', type: 'bridge', vmCount: 0, guests: [] },
    ])
    expect(summary.vlanBreakdown.map(v => [v.vlan, v.vmCount, v.bridges])).toEqual([[20, 0, ['vmbr1']], [30, 0, []]])
  })

  it('adds a guest to the bridge seeded by its host and sorts VLANs by guest count', () => {
    const summary = build({
      hostBridges: [{ connId: 'c1', node: 'pve1', iface: 'vmbr0', type: 'bridge' } as any],
      networkData: [
        vm({ vmid: '1', name: '', nets: [{ id: 'net0', bridge: 'vmbr0', tag: 5 }] }),
        vm({ vmid: '2', name: 'b', nets: [{ id: 'net0', bridge: 'ovsbr0', tag: 6 }] }),
        vm({ vmid: '3', name: 'c', nets: [{ id: 'net0', bridge: 'ovsbr0', tag: 6 }] }),
        vm({ vmid: '4', name: 'nic-less', nets: [] }),
      ],
    })

    expect(summary.bridgeBreakdown.map(b => [b.key, b.type, b.vmCount])).toEqual([
      ['c1:pve1:vmbr0', 'bridge', 1],
      ['c1:pve1:ovsbr0', 'ovs_bridge', 2],
    ])
    expect(summary.vlanBreakdown.map(v => [v.vlan, v.vmCount])).toEqual([[6, 2], [5, 1]])
    expect(summary.totalVmsWithNetwork).toBe(3)
  })

  it('keeps an interface without id or bridge out of the lists it cannot name', () => {
    const summary = build({ networkData: [vm({ connId: undefined, nets: [{ tag: 7 }] })] })

    expect(summary.vlanBreakdown[0].guests[0]).toMatchObject({ key: ':pve1:qemu:100', connId: '', ifaces: [], bridges: [] })
    expect(summary.bridgeBreakdown).toEqual([])
  })

  it('builds the inventory selection id of a guest', () => {
    expect(guestKey(vm({ type: 'lxc', vmid: '9911', node: 'pve1' }))).toBe('c1:pve1:lxc:9911')
  })
})
