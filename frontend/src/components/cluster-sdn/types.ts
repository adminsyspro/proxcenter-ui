// TypeScript mirrors of Proxmox VE SDN response shapes.
// Fields kept in PVE-native naming to stay aligned with upstream docs.

export interface SdnVersion {
  release: string
  repoid?: string
  version?: string
}

export interface SdnStatusResponse {
  version: SdnVersion
  pveMajor: number
  pending: boolean
  ipamBackends: string[]
}

export type SdnZoneType = 'simple' | 'vlan' | 'qinq' | 'vxlan' | 'evpn'

export interface SdnZone {
  zone: string
  type: SdnZoneType
  nodes?: string
  mtu?: number
  ipam?: string
  pending?: string | Record<string, unknown>
  state?: 'new' | 'changed' | 'deleted'
  [extra: string]: unknown
}

export interface SdnVNet {
  vnet: string
  zone: string
  tag?: number
  alias?: string
  vlanaware?: number | boolean
  state?: 'new' | 'changed' | 'deleted'
  pending?: string | Record<string, unknown>
  [extra: string]: unknown
}

export type SdnControllerType = 'evpn' | 'bgp' | 'isis'

export interface SdnController {
  controller: string
  type: SdnControllerType
  nodes?: string
  [extra: string]: unknown
}

export interface SdnIpam {
  ipam: string
  type: string
  [extra: string]: unknown
}

export interface SdnIpamAllocation {
  hostname?: string
  vmid?: number
  ip: string
  mac?: string
  [extra: string]: unknown
}

export interface SdnDns {
  dns: string
  type: string
  [extra: string]: unknown
}

export interface SdnFirewallRule {
  pos: number
  enable?: number
  type: 'in' | 'out' | 'group'
  action: string
  macro?: string
  proto?: string
  source?: string
  sport?: string
  dest?: string
  dport?: string
  log?: string
  comment?: string
  [extra: string]: unknown
}

export type SdnFabricProtocol = 'openfabric' | 'ospf'

export interface SdnFabric {
  fabric: string
  protocol: SdnFabricProtocol
  ipv4?: string
  ipv6?: string
  interfaces?: string
  [extra: string]: unknown
}

export interface SdnFabricNode {
  fabric: string
  node: string
  [extra: string]: unknown
}

export interface SdnFabricsResponse {
  unavailable?: boolean
  reason?: 'pve-version'
  fabrics?: SdnFabric[]
  nodes?: SdnFabricNode[]
}
