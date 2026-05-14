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
  lastSyncedAt: string | null
}

export interface VdcSharedBridge {
  id: string
  vdcId: string
  bridge: string
  label: string | null
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
  vxlanTag: number
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
  type: 'vxlan'
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
}

export interface UpdateVdcInput {
  name?: string
  description?: string
  enabled?: boolean
  nodes?: string[]
  primaryStorage?: string
  quota?: Partial<VdcQuota>
  sharedBridges?: Array<{ bridge: string; label?: string }>
}
