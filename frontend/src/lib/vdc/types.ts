import type { VdcComputePolicy } from './computePolicy'
import type { VdcTransport } from './transport'

/** Who provides gateway, DHCP and NAT on the vDC networks (#904). */
export type VdcEdgeModel = 'tenant' | 'platform'
export const EDGE_MODELS: readonly VdcEdgeModel[] = ['tenant', 'platform']

/** A row edited by hand must not break every listing: unknown = tenant edge. */
export function rowToEdgeModel(raw: string | null | undefined): VdcEdgeModel {
  return EDGE_MODELS.includes(raw as VdcEdgeModel) ? (raw as VdcEdgeModel) : 'tenant'
}

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
  computePolicy: VdcComputePolicy
  /** The tenant may create blank VMs and install them from an ISO (#1171);
   *  off, it deploys from the template catalogue only. */
  allowBlankVms: boolean
  /** How the vDC's VXLAN zone reaches its peers (#899). */
  transport: VdcTransport
  /** `tenant`: the tenant brings its own L3 edge, pure L2 networks allowed.
   *  `platform`: the provider operates the edge, every network has a subnet. */
  edgeModel: VdcEdgeModel
  enabled: boolean
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export type { VdcComputePolicy, CpuModelMode } from './computePolicy'
export type { VdcTransport, VxlanTransportMode } from './transport'

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
  storagePolicies: VdcStoragePolicyDto[]
  pbsBindings: VdcPbsBinding[]
  /** ISO storages granted to the tenant (#894): read-only catalogue, plus an
   *  optional upload area for the tenant's own `custom-<slug>-*` files. */
  isoLibraries: VdcIsoLibraryGrant[]
  /** Provider catalogue entries granted to this vDC (#903). */
  catalogGrants: VdcCatalogGrantsDto
}

export interface VdcCatalogGrantsDto {
  imageIds: string[]
  blueprintIds: string[]
}

export interface VdcIsoLibraryGrant {
  storageId: string
  allowUploads: boolean
}

export type VdcIsoLibraryInput = string | { storageId: string; allowUploads?: boolean }

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
  /** L3 / IPAM config attached to the VNet. Null for a pure L2 network
   *  (roadmap#18): the tenant addresses it itself, ProxCenter assigns no IP. */
  subnet: VdcSubnet | null
  /** Set when a stretched tenant network created this VNet (#901): the
   *  provider manages it, and `subnet.id` is the network's shared pool. */
  tenantNetwork: { id: string; name: string } | null
  createdBy: string | null
  createdAt: string
}

export interface VdcSubnet {
  id: string
  /** Null for the canonical subnet of a stretched tenant network (#901). */
  vnetId: string | null
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
  sdnZoneName?: string
  quota?: Partial<VdcQuota>
  sharedBridges?: Array<{ bridge: string; label?: string }>
  vlanPools?: Array<{ bridge: string; rangeStart: number; rangeEnd: number }>
  storagePolicies?: Array<{ policyId: string; quotaMb: number | null }>
  computePolicy?: Partial<VdcComputePolicy>
  allowBlankVms?: boolean
  isoLibraries?: VdcIsoLibraryInput[]
  transport?: Partial<VdcTransport>
  catalogGrants?: Partial<VdcCatalogGrantsDto>
  edgeModel?: VdcEdgeModel
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
  computePolicy?: Partial<VdcComputePolicy>
  allowBlankVms?: boolean
  isoLibraries?: VdcIsoLibraryInput[]
  transport?: Partial<VdcTransport>
  catalogGrants?: Partial<VdcCatalogGrantsDto>
  edgeModel?: VdcEdgeModel
}
