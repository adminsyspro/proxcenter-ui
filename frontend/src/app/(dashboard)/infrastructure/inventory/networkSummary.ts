import type { HostBridgeItem, HostVlanItem, SdnVnetItem } from '@/lib/proxmox/fetchConnectionsNetworks'
import type { SdnVnet } from '@/lib/proxmox/sdnVnetMap'

export type VmNetData = {
  vmid: string
  name: string
  node: string
  type: string
  status: string
  connId?: string
  nets: Array<{ id?: string; bridge?: string; tag?: number; model?: string; macaddr?: string; firewall?: boolean }>
}

/** A guest attached to a network, with the interfaces it has on it. */
export type AttachedGuest = {
  /** Inventory selection id of the guest: `connId:node:type:vmid`. */
  key: string
  connId: string
  vmid: string
  name: string
  node: string
  type: string
  status: string
  /** Interfaces of this guest on the network (net0, net1…). */
  ifaces: string[]
  /** Bridges the interfaces sit on, for a VLAN that spans several bridges. */
  bridges: string[]
}

export type VlanEntry = { vlan: number; vmCount: number; bridges: string[]; guests: AttachedGuest[] }
export type BridgeEntry = { key: string; bridge: string; node: string; connId: string; connName: string; type: string; vmCount: number; guests: AttachedGuest[] }
export type VnetEntry = { key: string; vnet: SdnVnet; vmCount: number; guests: AttachedGuest[] }

export type NetworkSummary = {
  totalBridges: number
  totalVlans: number
  totalVnets: number
  totalVmsWithNetwork: number
  vlanBreakdown: VlanEntry[]
  bridgeBreakdown: BridgeEntry[]
  vnetBreakdown: VnetEntry[]
}

export const guestKey = (vm: VmNetData) => `${vm.connId || ''}:${vm.node}:${vm.type}:${vm.vmid}`

/**
 * Records one interface of a guest on a network. A guest with two interfaces
 * on the same network is one guest with two interfaces, not two guests: the
 * counts shown next to each network are guest counts.
 */
function attach(guests: Map<string, AttachedGuest>, vm: VmNetData, net: VmNetData['nets'][number]) {
  const key = guestKey(vm)
  let guest = guests.get(key)
  if (!guest) {
    guest = { key, connId: vm.connId || '', vmid: vm.vmid, name: vm.name, node: vm.node, type: vm.type, status: vm.status, ifaces: [], bridges: [] }
    guests.set(key, guest)
  }
  if (net.id && !guest.ifaces.includes(net.id)) guest.ifaces.push(net.id)
  if (net.bridge && !guest.bridges.includes(net.bridge)) guest.bridges.push(net.bridge)
}

const byName = (a: AttachedGuest, b: AttachedGuest) =>
  (a.name || a.vmid).localeCompare(b.name || b.vmid) || a.node.localeCompare(b.node)

const guestList = (guests: Map<string, AttachedGuest>) => [...guests.values()].sort(byName)

/**
 * Groups the guests of the selected connections by SDN VNet, host bridge and
 * VLAN. Host bridges and VLANs are seeded from the hosts so a network without
 * any guest still shows up, with a count of zero.
 */
export function buildNetworkSummary({
  networkData, hostBridges, hostVlans, sdnVnets, connectionNames,
}: {
  networkData: VmNetData[]
  hostBridges: HostBridgeItem[]
  hostVlans: HostVlanItem[]
  sdnVnets: SdnVnetItem[]
  connectionNames: Record<string, string>
}): NetworkSummary {
  const bridgeMap = new Map<string, Omit<BridgeEntry, 'vmCount' | 'guests'> & { guests: Map<string, AttachedGuest> }>()
  const vlanMap = new Map<number, { vlan: number; bridges: Set<string>; guests: Map<string, AttachedGuest> }>()
  const vnetMap = new Map<string, { vnet: SdnVnet; guests: Map<string, AttachedGuest> }>()
  const sdnByConnVnet = new Map<string, Map<string, SdnVnet>>()
  for (const v of sdnVnets) {
    const cid = v.connId || ''
    if (!sdnByConnVnet.has(cid)) sdnByConnVnet.set(cid, new Map())
    sdnByConnVnet.get(cid)!.set(v.vnet, v)
  }

  const bridgeEntry = (connId: string, node: string, iface: string, type: string) => {
    const key = `${connId}:${node}:${iface}`
    let entry = bridgeMap.get(key)
    if (!entry) {
      entry = { key, bridge: iface, node, connId, connName: connectionNames[connId] || connId, type, guests: new Map() }
      bridgeMap.set(key, entry)
    }
    return entry
  }
  const vlanEntry = (tag: number) => {
    let entry = vlanMap.get(tag)
    if (!entry) {
      entry = { vlan: tag, bridges: new Set(), guests: new Map() }
      vlanMap.set(tag, entry)
    }
    return entry
  }

  for (const b of hostBridges) {
    bridgeEntry(b.connId, b.node, b.iface, b.type === 'OVSBridge' ? 'ovs_bridge' : 'bridge')
    if (b.tag != null) vlanEntry(b.tag).bridges.add(b.iface)
  }
  // VLAN sub-interfaces too, so VLAN-aware-bridge layouts list their VLANs (issue #542).
  for (const v of hostVlans) vlanEntry(v.tag)

  let totalVmsWithNetwork = 0
  for (const vm of networkData) {
    if (vm.nets.length > 0) totalVmsWithNetwork++
    const connId = vm.connId || ''
    const vnetsForConn = sdnByConnVnet.get(connId)
    for (const net of vm.nets) {
      const vnet = net.bridge ? vnetsForConn?.get(net.bridge) : undefined
      if (vnet) {
        const key = `${connId} ${vnet.vnet}`
        if (!vnetMap.has(key)) vnetMap.set(key, { vnet, guests: new Map() })
        attach(vnetMap.get(key)!.guests, vm, net)
        continue // a vnet-backed nic is neither a plain bridge nor a VLAN bucket
      }
      if (net.bridge) {
        attach(bridgeEntry(connId, vm.node, net.bridge, net.bridge.startsWith('ovs') ? 'ovs_bridge' : 'bridge').guests, vm, net)
      }
      if (net.tag != null) {
        const entry = vlanEntry(net.tag)
        if (net.bridge) entry.bridges.add(net.bridge)
        attach(entry.guests, vm, net)
      }
    }
  }

  const byCount = (a: { vmCount: number }, b: { vmCount: number }) => b.vmCount - a.vmCount
  return {
    totalBridges: bridgeMap.size,
    totalVlans: vlanMap.size,
    totalVnets: vnetMap.size,
    totalVmsWithNetwork,
    vlanBreakdown: [...vlanMap.values()]
      .map(v => ({ vlan: v.vlan, bridges: [...v.bridges], vmCount: v.guests.size, guests: guestList(v.guests) }))
      .sort(byCount),
    bridgeBreakdown: [...bridgeMap.values()].map(b => ({ ...b, vmCount: b.guests.size, guests: guestList(b.guests) })),
    vnetBreakdown: [...vnetMap.entries()]
      .map(([key, v]) => ({ key, vnet: v.vnet, vmCount: v.guests.size, guests: guestList(v.guests) }))
      .sort(byCount),
  }
}
