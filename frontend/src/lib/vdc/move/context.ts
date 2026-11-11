// Database side of a move between vDCs (#1335): the vDCs of a tenant with
// what a move needs from each (pool, nodes, storages and their policies,
// networks, VLAN pools, quotas, compute policy), and the PVE connections
// loaded the same way whether a request or a background reconciler runs.

import { prisma } from '@/lib/db/prisma'
import { getConnectionById } from '@/lib/connections/getConnection'
import { normalizeComputePolicyInput, type VdcComputePolicy } from '@/lib/vdc/computePolicy'
import type { DriveQosCaps } from '@/lib/vdc/drives'
import type { VdcResolveResult } from '@/lib/vdc/quota'

export interface MoveVdcPolicy {
  policyId: string
  name: string
  storageId: string
  quotaMb: number | null
  caps: DriveQosCaps
}

export interface MoveVdcNetwork {
  /** PVE VNet id or host bridge name, as it appears in `bridge=` */
  bridge: string
  label: string
  kind: 'vnet' | 'shared'
  vnetId: string | null
  /** Stretched tenant network (#901) this VNet is a member of. */
  tenantNetworkId: string | null
}

export interface MoveVdc {
  id: string
  tenantId: string
  name: string
  connectionId: string
  poolName: string
  nodes: Set<string>
  primaryStorage: string | null
  policies: MoveVdcPolicy[]
  networks: MoveVdcNetwork[]
  vlanRanges: Map<string, Array<[number, number]>>
  quota: VdcResolveResult['quota']
  computePolicy: VdcComputePolicy
}

const VDC_SELECT = {
  id: true,
  tenantId: true,
  name: true,
  connectionId: true,
  pvePoolName: true,
  primaryStorage: true,
  cpuModelMode: true,
  cpuAllowedModels: true,
  cpuDefaultModel: true,
  cpuAdvancedSettings: true,
  quota: true,
  nodes: { select: { nodeName: true } },
  storagePolicies: {
    select: {
      quotaMb: true,
      policy: { select: { id: true, name: true, storageId: true, iopsRd: true, iopsWr: true, mbpsRd: true, mbpsWr: true } },
    },
  },
  vnets: { select: { id: true, pveName: true, displayName: true, tenantNetworkMember: { select: { tenantNetworkId: true } } } },
  sharedBridges: { select: { bridge: true, label: true } },
  vlanPools: { select: { bridge: true, rangeStart: true, rangeEnd: true } },
} as const

function toMoveVdc(row: any): MoveVdc {
  const vlanRanges = new Map<string, Array<[number, number]>>()
  for (const pool of row.vlanPools ?? []) {
    const list = vlanRanges.get(pool.bridge) ?? []
    list.push([pool.rangeStart, pool.rangeEnd])
    vlanRanges.set(pool.bridge, list)
  }

  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    connectionId: row.connectionId,
    poolName: row.pvePoolName,
    nodes: new Set((row.nodes ?? []).map((n: any) => n.nodeName)),
    primaryStorage: row.primaryStorage ?? null,
    policies: (row.storagePolicies ?? []).map((sp: any) => ({
      policyId: sp.policy.id,
      name: sp.policy.name,
      storageId: sp.policy.storageId,
      quotaMb: sp.quotaMb ?? null,
      caps: { iopsRd: sp.policy.iopsRd ?? null, iopsWr: sp.policy.iopsWr ?? null, mbpsRd: sp.policy.mbpsRd ?? null, mbpsWr: sp.policy.mbpsWr ?? null },
    })),
    networks: [
      ...(row.vnets ?? []).map((v: any) => ({
        bridge: v.pveName,
        label: v.displayName || v.pveName,
        kind: 'vnet' as const,
        vnetId: v.id,
        tenantNetworkId: v.tenantNetworkMember?.tenantNetworkId ?? null,
      })),
      ...(row.sharedBridges ?? []).map((b: any) => ({
        bridge: b.bridge,
        label: b.label || b.bridge,
        kind: 'shared' as const,
        vnetId: null,
        tenantNetworkId: null,
      })),
    ],
    vlanRanges,
    quota: row.quota
      ? {
          maxVcpus: row.quota.maxVcpus ?? null,
          maxRamMb: row.quota.maxRamMb ?? null,
          maxStorageMb: row.quota.maxStorageMb ?? null,
          maxVms: row.quota.maxVms ?? null,
          maxSnapshots: row.quota.maxSnapshots ?? null,
          maxBackups: row.quota.maxBackups ?? null,
        }
      : null,
    computePolicy: normalizeComputePolicyInput({
      cpuModelMode: row.cpuModelMode,
      cpuAllowedModels: row.cpuAllowedModels,
      cpuDefaultModel: row.cpuDefaultModel,
      cpuAdvancedSettings: row.cpuAdvancedSettings,
    }),
  }
}

/** Enabled vDCs of a tenant. */
export async function loadTenantVdcs(tenantId: string): Promise<MoveVdc[]> {
  const rows = await prisma.vdc.findMany({ where: { tenantId, enabled: true }, select: VDC_SELECT, orderBy: { name: 'asc' } })

  return rows.map(toMoveVdc)
}

/** The enabled vDC whose PVE pool holds a guest of `connectionId`, if any. */
export async function findVdcByPool(connectionId: string, poolName: string): Promise<MoveVdc | null> {
  const row = await prisma.vdc.findFirst({ where: { connectionId, pvePoolName: poolName, enabled: true }, select: VDC_SELECT })

  return row ? toMoveVdc(row) : null
}

export async function loadVdcById(id: string): Promise<MoveVdc | null> {
  const row = await prisma.vdc.findUnique({ where: { id }, select: VDC_SELECT })

  return row ? toMoveVdc(row) : null
}

/** Storages a guest disk may land on in a vDC: the primary storage and every policy tier. */
export function diskStoragesOf(vdc: MoveVdc): Set<string> {
  const set = new Set<string>(vdc.policies.map((p) => p.storageId))
  if (vdc.primaryStorage) set.add(vdc.primaryStorage)

  return set
}

/** Caps of the policy bound to `storage` in this vDC, undefined when the storage has none. */
export function policyCapsFor(vdc: MoveVdc, storage: string): DriveQosCaps | undefined {
  return vdc.policies.find((p) => p.storageId === storage)?.caps
}

/**
 * A PVE connection loaded as its owner tenant: vDC connections belong to the
 * provider, and the background reconciler has no session to resolve them.
 */
export async function loadPveConnection(connectionId: string): Promise<any> {
  return getConnectionById(connectionId, await connectionOwnerTenant(connectionId))
}

/**
 * Tenant that owns a PVE connection (the provider for a vDC cluster). Its SSH
 * credentials are read under that tenant: the vDC tenant has none.
 */
export async function connectionOwnerTenant(connectionId: string): Promise<string> {
  const row = await prisma.connection.findUnique({ where: { id: connectionId }, select: { tenantId: true } })
  if (!row) throw new Error('Connection not found')

  return row.tenantId
}

export function quotaPoliciesOf(vdc: MoveVdc): VdcResolveResult['storagePolicies'] {
  return vdc.policies.map((p) => ({ policyId: p.policyId, name: p.name, storageId: p.storageId, quotaMb: p.quotaMb }))
}
