export interface Vdc {
  id: string
  tenantId: string
  connectionId: string
  name: string
  slug: string
  description: string | null
  pvePoolName: string
  sdnZoneName: string | null
  /** Single shared storage backing this vDC's VM disks. Null on legacy
   *  vDCs created before the migration; the admin must re-pick a shared
   *  storage before tenants can deploy. New vDCs are validated to point
   *  at a shared+images storage. */
  primaryStorage: string | null
  enabled: boolean
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export interface VdcWithDetails extends Vdc {
  tenantName?: string
  connectionName?: string
  nodes: string[]
  storages: string[]
  quota: VdcQuota | null
  usage: VdcUsage | null
  sharedBridges: VdcSharedBridge[]
  vnets: VdcVnet[]
  vlanPools: VdcVlanPool[]
  storagePolicies?: VdcStoragePolicyDto[]
  pbsBindings: VdcPbsBinding[]
}

export interface VdcPbsBinding {
  id: string
  vdcId: string
  pbsConnectionId: string
  pbsConnectionName: string
  datastore: string
  namespace: string
  mode: 'auto' | 'manual'
  createdAt: string
}

export interface VdcQuota {
  maxVcpus: number | null
  maxRamMb: number | null
  maxStorageMb: number | null
  maxVms: number | null
  maxSnapshots: number | null
  maxBackups: number | null
  maxVnets: number | null
}

export interface VdcUsage {
  usedVcpus: number
  usedRamMb: number
  usedStorageMb: number
  usedVms: number
  usedSnapshots: number
  usedBackups: number
  usedStorageByStorage?: Record<string, number> | null
  lastSyncedAt: string | null
}

export interface StoragePolicyDto {
  id: string
  connectionId: string
  name: string
  description: string | null
  storageId: string
  iopsRd: number | null
  iopsWr: number | null
  mbpsRd: number | null
  mbpsWr: number | null
  vdcCount?: number
  createdAt: string
  updatedAt: string
}

export interface VdcStoragePolicyDto {
  policyId: string
  name: string
  storageId: string
  iopsRd: number | null
  iopsWr: number | null
  mbpsRd: number | null
  mbpsWr: number | null
  quotaMb: number | null
}

export interface VdcSharedBridge {
  id: string
  vdcId: string
  bridge: string
  label: string | null
  createdAt: string
}

export interface VdcVlanPool {
  id: string
  vdcId: string
  bridge: string
  rangeStart: number
  rangeEnd: number
  createdAt: string
}

export interface VdcVnet {
  id: string
  vdcId: string
  /** Hash-based 8-char ID sent to PVE (always unique cluster-wide). */
  pveName: string
  /** Friendly name shown to the tenant (free-form, unique per vDC). */
  displayName: string
  description: string | null
  tag: number
  type: 'vxlan' | 'vlan'
  bridge: string | null
  zoneName: string | null
  firewall: boolean
  /** L3 / IPAM config attached to the VNet. Always present — the VNet is
   *  unusable without a subnet (the IPAM is the only mechanism to allocate
   *  IPs on VXLAN, where PVE-native DHCP/IPAM is broken on PVE 9.x). */
  subnet: VdcSubnet
  createdBy: string | null
  createdAt: string
}

export interface VdcSubnet {
  id: string
  vnetId: string
  cidr: string
  gateway: string
  dnsServers: string[]
  ipamEnabled: boolean
  createdAt: string
}

// PVE-native shapes used by lib/vdc/sdn.ts
export interface SdnZone {
  zone: string
  type: 'vxlan' | 'vlan'
  peers: string[]
}

export interface SdnVnet {
  vnet: string
  zone: string
  tag: number
  firewall: 0 | 1
}

export interface CreateVdcInput {
  tenantId: string
  connectionId: string
  name: string
  slug: string
  description?: string
  nodes: string[]
  /** Single shared storage. Validated against the connection's storage
   *  list (must be `shared=true` and advertise `content=images`). */
  primaryStorage: string
  quota?: Partial<VdcQuota>
  sharedBridges?: Array<{ bridge: string; label?: string }>
  vlanPools?: Array<{ bridge: string; rangeStart: number; rangeEnd: number }>
  storagePolicies?: Array<{ policyId: string; quotaMb: number | null }>
}

export interface UpdateVdcInput {
  name?: string
  description?: string
  enabled?: boolean
  nodes?: string[]
  primaryStorage?: string
  quota?: Partial<VdcQuota>
  sharedBridges?: Array<{ bridge: string; label?: string }>
  vlanPools?: Array<{ bridge: string; rangeStart: number; rangeEnd: number }>
  storagePolicies?: Array<{ policyId: string; quotaMb: number | null }>
}
