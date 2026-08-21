// src/lib/vdc/index.ts
// vDC CRUD library with PVE pool integration (Postgres / Prisma).

import { randomUUID } from 'crypto'

import { pveFetch } from '@/lib/proxmox/client'
import { pbsFetch } from '@/lib/proxmox/pbs-client'
import { getConnectionById } from '@/lib/connections/getConnection'
import { prisma } from '@/lib/db/prisma'
import { decryptSecret } from '@/lib/crypto/secret'
import { DEFAULT_TENANT_ID } from '@/lib/tenant'

import { generateZoneName, createZone, deleteZone, deleteVnetPve, applySdn } from './sdn'
import { clearVdcScopeCache } from './scope'
import { validateVlanPoolsInput, assertNoCrossVdcOverlap, assertPoolShrinkSafe, type VlanPoolInput } from './vlan'
import { getVdcStorageUsedMb } from './quota'

import type {
  Vdc,
  VdcWithDetails,
  VdcQuota,
  VdcUsage,
  CreateVdcInput,
  UpdateVdcInput,
} from './types'

// Re-export all types
export type { Vdc, VdcWithDetails, VdcQuota, VdcUsage, CreateVdcInput, UpdateVdcInput } from './types'

// ---------------------------------------------------------------------------
// Row mapping helpers
// ---------------------------------------------------------------------------

type VdcRow = {
  id: string
  tenantId: string
  connectionId: string
  name: string
  slug: string
  description: string | null
  pvePoolName: string
  enabled: boolean | null
  primaryStorage: string | null
  sdnZoneName: string | null
  createdBy: string | null
  createdAt: Date
  updatedAt: Date
}

function rowToVdc(row: VdcRow): Vdc {
  return {
    id: row.id,
    tenantId: row.tenantId,
    connectionId: row.connectionId,
    name: row.name,
    slug: row.slug,
    description: row.description ?? null,
    pvePoolName: row.pvePoolName,
    sdnZoneName: row.sdnZoneName ?? null,
    primaryStorage: row.primaryStorage ?? null,
    enabled: row.enabled !== false,
    createdBy: row.createdBy ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function rowToQuota(row: any): VdcQuota | null {
  if (!row) return null
  return {
    maxVcpus: row.maxVcpus ?? null,
    maxRamMb: row.maxRamMb ?? null,
    maxStorageMb: row.maxStorageMb ?? null,
    maxVms: row.maxVms ?? null,
    maxSnapshots: row.maxSnapshots ?? null,
    maxBackups: row.maxBackups ?? null,
    maxVnets: row.maxVnets ?? null,
  }
}

function rowToUsage(row: any): VdcUsage | null {
  if (!row) return null
  return {
    usedVcpus: row.usedVcpus ?? 0,
    usedRamMb: row.usedRamMb ?? 0,
    usedStorageMb: row.usedStorageMb ?? 0,
    usedVms: row.usedVms ?? 0,
    usedSnapshots: row.usedSnapshots ?? 0,
    usedBackups: row.usedBackups ?? 0,
    usedStorageByStorage: row.usedStorageByStorage ?? null,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
  }
}

function generatePoolName(tenantSlug: string, vdcSlug: string): string {
  return `vdc-${tenantSlug}-${vdcSlug}`
}

/** Resolve the real owner tenantId of a connection (it may differ from the vDC's tenantId) */
async function getConnectionOwnerTenantId(connectionId: string): Promise<string> {
  const conn = await prisma.connection.findUnique({ where: { id: connectionId }, select: { tenantId: true } })
  if (!conn) throw new Error(`Connection not found: ${connectionId}`)
  return conn.tenantId
}

/**
 * Project a Prisma vDC row (with all child relations included) into the
 * VdcWithDetails wire shape consumed by the frontend. Matches the legacy
 * SQLite output column-for-column.
 */
function buildVdcWithDetails(row: any, pbsConnNames?: Map<string, string>): VdcWithDetails {
  const vdc = rowToVdc(row)
  const nodes = row.nodes.map((n: any) => n.nodeName)
  // VdcWithDetails.storages = primary VM-disk storage + PBS pseudo-storages
  // (kept in vdc_storages as `pbs:<id>` rows by pbsOrchestrator).
  const pbsStorages = row.storages.map((s: any) => s.storageId)
  const storages = vdc.primaryStorage
    ? [vdc.primaryStorage, ...pbsStorages.filter((s: string) => s !== vdc.primaryStorage)]
    : pbsStorages
  const quota = rowToQuota(row.quota)
  const usage = rowToUsage(row.usageCache)
  const sharedBridges = row.sharedBridges.map((b: any) => ({
    id: b.id,
    vdcId: b.vdcId,
    bridge: b.bridge,
    label: b.label ?? null,
    createdAt: b.createdAt.toISOString(),
  }))
  const vnets = row.vnets.map((v: any) => ({
    id: v.id,
    vdcId: v.vdcId,
    pveName: v.pveName,
    displayName: v.displayName ?? v.pveName,
    description: v.description ?? null,
    tag: v.tag,
    type: (v.type ?? 'vxlan') as 'vxlan' | 'vlan',
    bridge: v.bridge ?? null,
    zoneName: v.zoneName ?? null,
    firewall: v.firewall !== false,
    subnet: v.subnet
      ? {
          id: v.subnet.id,
          vnetId: v.id,
          cidr: v.subnet.cidr,
          gateway: v.subnet.gateway,
          dnsServers: v.subnet.dnsServers
            ? String(v.subnet.dnsServers).split(',').map((s: string) => s.trim()).filter(Boolean)
            : [],
          ipamEnabled: v.subnet.ipamEnabled !== false,
          createdAt: v.subnet.createdAt.toISOString(),
        }
      : null,
    createdBy: v.createdBy ?? null,
    createdAt: v.createdAt.toISOString(),
  }))
  const vlanPools = (row.vlanPools ?? []).map((p: any) => ({
    id: p.id,
    vdcId: p.vdcId,
    bridge: p.bridge,
    rangeStart: p.rangeStart,
    rangeEnd: p.rangeEnd,
    createdAt: p.createdAt.toISOString(),
  }))
  const storagePolicies = (row.storagePolicies ?? []).map((sp: any) => ({
    policyId: sp.policyId,
    name: sp.policy.name,
    storageId: sp.policy.storageId,
    iopsRd: sp.policy.iopsRd ?? null,
    iopsWr: sp.policy.iopsWr ?? null,
    mbpsRd: sp.policy.mbpsRd ?? null,
    mbpsWr: sp.policy.mbpsWr ?? null,
    quotaMb: sp.quotaMb ?? null,
  }))
  const pbsBindings = row.pbsNamespaces.map((b: any) => ({
    id: b.id,
    vdcId: b.vdcId,
    pbsConnectionId: b.pbsConnectionId,
    pbsConnectionName: pbsConnNames?.get(b.pbsConnectionId) ?? b.pbsConnectionId,
    datastore: b.datastore,
    namespace: b.namespace,
    mode: (b.mode ?? 'auto') as 'auto' | 'manual',
    createdAt: b.createdAt.toISOString(),
  }))

  return {
    ...vdc,
    tenantName: row.tenant?.name ?? undefined,
    nodes,
    storages,
    quota,
    usage,
    sharedBridges,
    vnets,
    vlanPools,
    storagePolicies,
    pbsBindings,
  }
}

const vdcWithDetailsInclude = {
  tenant: { select: { name: true } },
  nodes: true,
  storages: true,
  quota: true,
  usageCache: true,
  sharedBridges: { orderBy: { bridge: 'asc' as const } },
  vnets: {
    include: { subnet: true },
    orderBy: { pveName: 'asc' as const },
  },
  vlanPools: {
    orderBy: [{ bridge: 'asc' as const }, { rangeStart: 'asc' as const }] as (
      { bridge: 'asc' } | { rangeStart: 'asc' }
    )[],
  },
  storagePolicies: { include: { policy: true }, orderBy: { createdAt: 'asc' as const } },
  pbsNamespaces: true,
} as const

// ---------------------------------------------------------------------------
// listVdcs
// ---------------------------------------------------------------------------

/** Fetch a map of connectionId → connection name for a set of PBS connection IDs. */
async function fetchPbsConnNames(connIds: Set<string>): Promise<Map<string, string>> {
  if (connIds.size === 0) return new Map()
  const rows = await prisma.connection.findMany({
    where: { id: { in: [...connIds] } },
    select: { id: true, name: true },
  })
  return new Map(rows.map(r => [r.id, r.name]))
}

export async function listVdcs(tenantId?: string): Promise<VdcWithDetails[]> {
  const rows = await prisma.vdc.findMany({
    where: tenantId ? { tenantId } : undefined,
    include: vdcWithDetailsInclude,
    orderBy: { name: 'asc' },
  })
  // Collect all unique PBS connection IDs across all rows, then fetch names in one query.
  const allPbsConnIds = new Set<string>()
  for (const row of rows) {
    for (const ns of row.pbsNamespaces) allPbsConnIds.add(ns.pbsConnectionId)
  }
  const pbsConnNames = await fetchPbsConnNames(allPbsConnIds)
  // Sort PBS bindings client-side: connection name → datastore → namespace.
  return rows.map(row => {
    const sortedPbs = [...row.pbsNamespaces].sort((a, b) => {
      const an = pbsConnNames.get(a.pbsConnectionId) ?? a.pbsConnectionId
      const bn = pbsConnNames.get(b.pbsConnectionId) ?? b.pbsConnectionId
      if (an !== bn) return an.localeCompare(bn)
      if (a.datastore !== b.datastore) return a.datastore.localeCompare(b.datastore)
      return a.namespace.localeCompare(b.namespace)
    })
    return buildVdcWithDetails({ ...row, pbsNamespaces: sortedPbs }, pbsConnNames)
  })
}

// ---------------------------------------------------------------------------
// getVdcById
// ---------------------------------------------------------------------------

export async function getVdcById(id: string): Promise<VdcWithDetails | null> {
  const row = await prisma.vdc.findUnique({
    where: { id },
    include: vdcWithDetailsInclude,
  })

  if (!row) return null

  const pbsConnNames = await fetchPbsConnNames(new Set(row.pbsNamespaces.map(ns => ns.pbsConnectionId)))
  const sortedPbs = [...row.pbsNamespaces].sort((a, b) => {
    const an = pbsConnNames.get(a.pbsConnectionId) ?? a.pbsConnectionId
    const bn = pbsConnNames.get(b.pbsConnectionId) ?? b.pbsConnectionId
    if (an !== bn) return an.localeCompare(bn)
    if (a.datastore !== b.datastore) return a.datastore.localeCompare(b.datastore)
    return a.namespace.localeCompare(b.namespace)
  })

  return buildVdcWithDetails({ ...row, pbsNamespaces: sortedPbs }, pbsConnNames)
}

// ---------------------------------------------------------------------------
// createVdc
// ---------------------------------------------------------------------------

export async function createVdc(input: CreateVdcInput, createdBy: string | null): Promise<VdcWithDetails> {
  // 0. The provider tenant (default) owns connections directly — it never
  // consumes its own infra through a vDC slice. Allowing a vDC on default
  // would also create a tenantHasVdc==true state that flips parts of the
  // UI into "tenant mode" for the provider, which is the wrong shape.
  // /settings?tab=vdc filters `default` out of the picker, but a direct
  // POST would bypass that — refuse here so the rule survives any client.
  if (input.tenantId === DEFAULT_TENANT_ID) {
    throw new Error('vDCs cannot be created on the provider tenant (default)')
  }

  // 1. Resolve tenant slug.
  const tenantRow = await prisma.tenant.findUnique({
    where: { id: input.tenantId },
    select: { slug: true },
  })
  if (!tenantRow) {
    throw new Error(`Tenant not found: ${input.tenantId}`)
  }
  const tenantSlug = tenantRow.slug

  // 1bis. Business rule: max one vDC per (tenant, connection). The DB
  // unique (tenant_id, connection_id) is the real invariant (races land
  // there as P2002); this guard only provides the friendly message.
  const existingOnConnection = await prisma.vdc.findFirst({
    where: { tenantId: input.tenantId, connectionId: input.connectionId },
    select: { id: true, name: true },
  })
  if (existingOnConnection) {
    throw new Error(
      `Tenant already has a vDC on this cluster ("${existingOnConnection.name}"). ` +
      `One vDC per tenant per cluster.`
    )
  }

  // 2. Check slug uniqueness tenant-wide (all connections). The default PBS
  // namespace derives from the slug (pbsOrchestrator), and PBS binding
  // tuples are globally unique — two same-name clusters would collide.
  const existing = await prisma.vdc.findFirst({
    where: { tenantId: input.tenantId, slug: input.slug },
    select: { id: true },
  })
  if (existing) {
    throw new Error(
      `A vDC with slug "${input.slug}" already exists for this tenant ` +
      `(two clusters with the same display name? rename one connection)`
    )
  }

  // 2bis. vDCs may only slice provider-pool connections (IaaS/MSP
  // exclusivity). The FK to provider_connections would reject the insert
  // anyway, but only after the PVE pool was created — refuse up front.
  const poolMembership = await prisma.providerConnection.findUnique({
    where: { connectionId: input.connectionId },
    select: { connectionId: true },
  })
  if (!poolMembership) {
    throw new Error(
      `Connection ${input.connectionId} is not in the provider pool — vDCs can only be created on provider-pool connections`
    )
  }

  // 2ter. Validate VLAN pools before any PVE side effect (pool/zone creation
  // below is not rolled back by a validation failure caught this early).
  const vlanPools: VlanPoolInput[] = input.vlanPools ?? []
  if (vlanPools.length > 0) {
    validateVlanPoolsInput(vlanPools)
    await assertNoCrossVdcOverlap(input.connectionId, null, vlanPools)
  }

  // 2quater. Same reasoning as 2ter: validate storage-policy assignments
  // before any PVE side effect (pool/zone creation below is not rolled back
  // by a validation failure caught this early).
  const storagePolicyAssignments = input.storagePolicies ?? []
  if (storagePolicyAssignments.length > 0) {
    const { validateVdcPolicyAssignments } = await import('./storagePolicies')
    await validateVdcPolicyAssignments(input.connectionId, storagePolicyAssignments)
  }

  // 3. Allocate vDC id (needed for zone generation)
  const id = randomUUID()
  const now = new Date()

  // 4. Create PVE pool (existing behavior)
  const poolName = generatePoolName(tenantSlug, input.slug)
  const connOwnerTenantId = await getConnectionOwnerTenantId(input.connectionId)
  const conn = await getConnectionById(input.connectionId, connOwnerTenantId)

  try {
    await pveFetch(conn, '/pools', {
      method: 'POST',
      body: new URLSearchParams({
        poolid: poolName,
        comment: `ProxCenter vDC: ${input.name}`,
      }),
    })
  } catch (err: any) {
    const msg = err?.message || ''
    if (!msg.includes('already exists')) {
      throw new Error(`Failed to create PVE pool "${poolName}": ${msg}`)
    }
    console.warn(`[vdc] PVE pool "${poolName}" already exists, proceeding`)
  }

  // 5. Create SDN zone on PVE
  const sdnZoneName = await generateZoneName(input.connectionId, { id, slug: input.slug })
  try {
    await createZone(conn, sdnZoneName)
  } catch (err: any) {
    try {
      await pveFetch(conn, `/pools/${encodeURIComponent(poolName)}`, { method: 'DELETE' })
    } catch {}
    throw new Error(`Failed to create SDN zone: ${err?.message}`)
  }

  // 6. DB transaction (Prisma)
  try {
    await prisma.$transaction(async tx => {
      await tx.vdc.create({
        data: {
          id,
          tenantId: input.tenantId,
          connectionId: input.connectionId,
          name: input.name,
          slug: input.slug,
          description: input.description ?? null,
          pvePoolName: poolName,
          sdnZoneName,
          primaryStorage: input.primaryStorage ?? null,
          enabled: true,
          createdBy,
          createdAt: now,
          updatedAt: now,
        },
      })

      if (input.nodes.length > 0) {
        await tx.vdcNode.createMany({
          data: input.nodes.map(nodeName => ({ id: randomUUID(), vdcId: id, nodeName })),
        })
      }

      // The legacy `vdc_storages` table is no longer used for the vDC's
      // VM disk storage — that lives in `vdcs.primary_storage` now. The
      // table is kept around for PBS pseudo-storage rows inserted by
      // pbsOrchestrator.bindPbsToVdc.

      if (input.quota) {
        await tx.vdcQuota.create({
          data: {
            id: randomUUID(),
            vdcId: id,
            maxVcpus: input.quota.maxVcpus ?? null,
            maxRamMb: input.quota.maxRamMb ?? null,
            maxStorageMb: input.quota.maxStorageMb ?? null,
            maxVms: input.quota.maxVms ?? null,
            maxSnapshots: input.quota.maxSnapshots ?? null,
            maxBackups: input.quota.maxBackups ?? null,
            maxVnets: input.quota.maxVnets ?? null,
            updatedAt: now,
          },
        })
      }

      if (input.sharedBridges && input.sharedBridges.length > 0) {
        await tx.vdcSharedBridge.createMany({
          data: input.sharedBridges.map(sb => ({
            id: randomUUID(),
            vdcId: id,
            bridge: sb.bridge,
            label: sb.label ?? null,
            createdAt: now,
          })),
        })
      }

      if (vlanPools.length > 0) {
        await tx.vdcVlanPool.createMany({
          data: vlanPools.map(p => ({
            id: randomUUID(), vdcId: id, bridge: p.bridge,
            rangeStart: p.rangeStart, rangeEnd: p.rangeEnd, createdAt: now,
          })),
        })
      }

      if (storagePolicyAssignments.length > 0) {
        await tx.vdcStoragePolicy.createMany({
          data: storagePolicyAssignments.map(sp => ({
            id: randomUUID(), vdcId: id, policyId: sp.policyId,
            quotaMb: sp.quotaMb ?? null, createdAt: now,
          })),
        })
      }

      await tx.vdcUsageCache.create({
        data: {
          id: randomUUID(),
          vdcId: id,
          usedVcpus: 0,
          usedRamMb: 0,
          usedStorageMb: 0,
          usedVms: 0,
          usedSnapshots: 0,
          usedBackups: 0,
          lastSyncedAt: null,
        },
      })
    })
  } catch (err: any) {
    // DB transaction failed - rollback PVE resources to avoid orphans
    try { await deleteZone(conn, sdnZoneName) } catch {}
    try {
      await pveFetch(conn, `/pools/${encodeURIComponent(poolName)}`, { method: 'DELETE' })
    } catch {}
    throw err
  }

  try {
    await applySdn(conn)
  } catch (err: any) {
    // Do not roll back - config is written to /etc/pve/sdn/*.cfg; admin can retry apply.
    console.warn(`[vdc] applySdn failed after creating zone "${sdnZoneName}": ${err?.message}`)
  }

  clearVdcScopeCache(input.tenantId)

  return (await getVdcById(id))!
}

// ---------------------------------------------------------------------------
// updateVdc
// ---------------------------------------------------------------------------

export async function updateVdc(id: string, input: UpdateVdcInput): Promise<VdcWithDetails> {
  // Verify vDC exists
  const existing = await prisma.vdc.findUnique({
    where: { id },
    select: { id: true, tenantId: true, connectionId: true },
  })
  if (!existing) {
    throw new Error(`vDC not found: ${id}`)
  }

  if (input.vlanPools) {
    validateVlanPoolsInput(input.vlanPools)
    await assertNoCrossVdcOverlap(existing.connectionId, id, input.vlanPools)
    await assertPoolShrinkSafe(id, input.vlanPools)
  }

  if (input.storagePolicies) {
    const { validateVdcPolicyAssignments, assertPolicyUnassignSafe } = await import('./storagePolicies')
    await validateVdcPolicyAssignments(existing.connectionId, input.storagePolicies)
    const kept = new Set(input.storagePolicies.map(sp => sp.policyId))
    const connOwner = await getConnectionOwnerTenantId(existing.connectionId)
    const guardConn = await getConnectionById(existing.connectionId, connOwner)
    await assertPolicyUnassignSafe(id, kept, guardConn)
  }

  const now = new Date()

  await prisma.$transaction(async tx => {
    const updateData: Record<string, unknown> = { updatedAt: now }
    if (input.name !== undefined) updateData.name = input.name
    if (input.description !== undefined) updateData.description = input.description
    if (input.enabled !== undefined) updateData.enabled = input.enabled
    if (input.primaryStorage !== undefined) updateData.primaryStorage = input.primaryStorage

    await tx.vdc.update({ where: { id }, data: updateData })

    if (input.nodes) {
      await tx.vdcNode.deleteMany({ where: { vdcId: id } })
      if (input.nodes.length > 0) {
        await tx.vdcNode.createMany({
          data: input.nodes.map(nodeName => ({ id: randomUUID(), vdcId: id, nodeName })),
        })
      }
    }

    if (input.sharedBridges) {
      await tx.vdcSharedBridge.deleteMany({ where: { vdcId: id } })
      if (input.sharedBridges.length > 0) {
        await tx.vdcSharedBridge.createMany({
          data: input.sharedBridges.map(sb => ({
            id: randomUUID(),
            vdcId: id,
            bridge: sb.bridge,
            label: sb.label ?? null,
            createdAt: now,
          })),
        })
      }
    }

    if (input.vlanPools) {
      await tx.vdcVlanPool.deleteMany({ where: { vdcId: id } })
      if (input.vlanPools.length > 0) {
        await tx.vdcVlanPool.createMany({
          data: input.vlanPools.map(p => ({
            id: randomUUID(), vdcId: id, bridge: p.bridge,
            rangeStart: p.rangeStart, rangeEnd: p.rangeEnd, createdAt: now,
          })),
        })
      }
    }

    if (input.storagePolicies) {
      await tx.vdcStoragePolicy.deleteMany({ where: { vdcId: id } })
      if (input.storagePolicies.length > 0) {
        await tx.vdcStoragePolicy.createMany({
          data: input.storagePolicies.map(sp => ({
            id: randomUUID(), vdcId: id, policyId: sp.policyId,
            quotaMb: sp.quotaMb ?? null, createdAt: now,
          })),
        })
      }
    }

    if (input.quota) {
      await tx.vdcQuota.upsert({
        where: { vdcId: id },
        update: {
          maxVcpus: input.quota.maxVcpus ?? null,
          maxRamMb: input.quota.maxRamMb ?? null,
          maxStorageMb: input.quota.maxStorageMb ?? null,
          maxVms: input.quota.maxVms ?? null,
          maxSnapshots: input.quota.maxSnapshots ?? null,
          maxBackups: input.quota.maxBackups ?? null,
          maxVnets: input.quota.maxVnets ?? null,
          updatedAt: now,
        },
        create: {
          id: randomUUID(),
          vdcId: id,
          maxVcpus: input.quota.maxVcpus ?? null,
          maxRamMb: input.quota.maxRamMb ?? null,
          maxStorageMb: input.quota.maxStorageMb ?? null,
          maxVms: input.quota.maxVms ?? null,
          maxSnapshots: input.quota.maxSnapshots ?? null,
          maxBackups: input.quota.maxBackups ?? null,
          maxVnets: input.quota.maxVnets ?? null,
          updatedAt: now,
        },
      })
    }
  })

  clearVdcScopeCache(existing.tenantId)

  return (await getVdcById(id))!
}

// ---------------------------------------------------------------------------
// deleteVdc
// ---------------------------------------------------------------------------

export async function deleteVdc(id: string): Promise<void> {
  // 1. Load vDC from DB
  const row = await prisma.vdc.findUnique({ where: { id } })
  if (!row) {
    throw new Error(`vDC not found: ${id}`)
  }
  const vdc = rowToVdc(row as VdcRow)

  // 2. Check PVE pool for VMs
  const connOwnerTenantId = await getConnectionOwnerTenantId(vdc.connectionId)
  const conn = await getConnectionById(vdc.connectionId, connOwnerTenantId)

  try {
    const poolData = await pveFetch<{ members?: any[] }>(conn, `/pools/${encodeURIComponent(vdc.pvePoolName)}`)
    const members = poolData?.members || []
    let vmMembers = members.filter(
      (m: any) => m.type === 'qemu' || m.type === 'lxc'
    )

    // Same ghost-filter as refreshVdcUsage: cross-reference with
    // /cluster/resources so deletion isn't blocked by stale pool refs
    // pointing to VMs that no longer exist. Same auto-cleanup attempt
    // — leftover ghosts wouldn't survive the pool deletion below
    // anyway, but cleaning them now logs a clearer trail.
    if (vmMembers.length > 0) {
      try {
        const liveResources = await pveFetch<any[]>(conn, '/cluster/resources?type=vm')
        const validIds = new Set(
          (liveResources || [])
            .filter((r: any) => r?.vmid != null)
            .map((r: any) => `${r.type}/${r.vmid}`),
        )
        const ghosts = vmMembers.filter(m => !validIds.has(`${m.type}/${m.vmid}`))
        vmMembers = vmMembers.filter(m => validIds.has(`${m.type}/${m.vmid}`))
        for (const g of ghosts) {
          try {
            await pveFetch(conn, `/pools/${encodeURIComponent(vdc.pvePoolName)}`, {
              method: 'PUT',
              body: new URLSearchParams({ delete: '1', vms: String(g.vmid) }),
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            } as any)
          } catch (err: any) {
            console.warn(`[vdc-delete] failed to clean ghost ${g.type}/${g.vmid}: ${err?.message}`)
          }
        }
      } catch (err: any) {
        console.warn(`[vdc-delete] /cluster/resources lookup failed: ${err?.message}`)
      }
    }

    if (vmMembers.length > 0) {
      throw new Error(
        `Cannot delete vDC "${vdc.name}": PVE pool "${vdc.pvePoolName}" still contains ${vmMembers.length} VM(s)/container(s). Remove them first.`
      )
    }
  } catch (err: any) {
    // If the pool doesn't exist on PVE side, that's fine - proceed with DB cleanup
    const msg = err?.message || ''
    if (msg.includes('Cannot delete vDC')) {
      throw err // re-throw our own check error
    }
    // Pool not found or unreachable - log and continue
    console.warn(`[vdc] Could not check PVE pool "${vdc.pvePoolName}": ${msg}`)
  }

  // 3. Delete all VNets of the vDC (best effort), whatever zone they live in.
  // The old code only ran this under `if (vdc.sdnZoneName)`, which would skip
  // the VLAN vnets of a vDC without a VXLAN zone.
  const vnetRows = await prisma.vdcVnet.findMany({
    where: { vdcId: id },
    select: { pveName: true },
  })
  for (const v of vnetRows) {
    try {
      await deleteVnetPve(conn, v.pveName)
    } catch (err: any) {
      console.warn(`[vdc] Failed to delete VNet "${v.pveName}": ${err?.message}`)
    }
  }

  // Delete the vDC's own VXLAN zone. The shared VLAN zones (sdn_vlan_zones)
  // are NEVER deleted here: they belong to the (connection, bridge) pair and
  // other vDCs may use them; an empty zone costs nothing.
  if (vdc.sdnZoneName) {
    try {
      await deleteZone(conn, vdc.sdnZoneName)
    } catch (err: any) {
      console.warn(`[vdc] Failed to delete SDN zone "${vdc.sdnZoneName}": ${err?.message}`)
    }
  }

  // 4. Delete PVE pool (best effort)
  try {
    await pveFetch(conn, `/pools/${encodeURIComponent(vdc.pvePoolName)}`, { method: 'DELETE' })
  } catch (err: any) {
    console.warn(`[vdc] Failed to delete PVE pool "${vdc.pvePoolName}" (best effort): ${err?.message}`)
  }

  // 5. Apply SDN changes if a vnet or a zone was touched above.
  if (vnetRows.length > 0 || vdc.sdnZoneName) {
    try {
      await applySdn(conn)
    } catch (err: any) {
      console.warn(`[vdc] applySdn failed after deleting zone "${vdc.sdnZoneName}": ${err?.message}`)
    }
  }

  // 6. Delete from DB. Postgres FK cascades drop child rows automatically
  // (Prisma schema declares onDelete: Cascade for every vdc_* child table).
  // PBS namespaces are intentionally NOT deleted here — the unbindFromVdc
  // loop in step 1 already handles them, including the PVE-side `pbs:`
  // storage + sub-token cleanup we don't want to duplicate.
  //
  // RBAC assignments that scoped a permission to this vDC's connection
  // (or to nodes / VMs / pool of it) survive the vDC drop because their
  // tenantId column has no FK to anything we delete here. Without manual
  // cleanup they end up dead-weight: the assignment still fires through
  // `hasPermission`, but the vDC gate denies every API call so the user
  // sees nothing — and the row pollutes /security/rbac. We remove them in
  // the same transaction so a half-failed delete either succeeds fully or
  // leaves the original state untouched.
  await prisma.$transaction(async tx => {
    // Only clean up RBAC rows belonging to the same (non-default) tenant.
    // The provider tenant owns connections directly, so its scoped RBAC
    // rows aren't dead-weight when a tenant's vDC drops — keep them.
    if (vdc.tenantId !== DEFAULT_TENANT_ID) {
      const nodeNames = await tx.vdcNode.findMany({
        where: { vdcId: id },
        select: { nodeName: true },
      })
      const nodeScopeTargets = nodeNames.map(n => `${vdc.connectionId}:${n.nodeName}`)

      await tx.rbacUserRole.deleteMany({
        where: {
          tenantId: vdc.tenantId,
          OR: [
            { scopeType: 'connection', scopeTarget: vdc.connectionId },
            ...(nodeScopeTargets.length > 0
              ? [{ scopeType: 'node', scopeTarget: { in: nodeScopeTargets } } as any]
              : []),
            {
              // VM-scoped: "connId:node:type:vmid" — startsWith via the
              // composite key. Prisma's `startsWith` on a String column
              // generates `LIKE '<connId>:%'` in Postgres.
              scopeType: 'vm',
              scopeTarget: { startsWith: `${vdc.connectionId}:` },
            },
            { scopeType: 'pool', scopeTarget: vdc.pvePoolName },
          ],
        },
      })
    }

    await tx.vdc.delete({ where: { id } })
  })

  clearVdcScopeCache(vdc.tenantId)
}

// ---------------------------------------------------------------------------
// refreshVdcUsage
// ---------------------------------------------------------------------------

export async function refreshVdcUsage(vdcId: string): Promise<VdcUsage> {
  // 1. Load vDC
  const row = await prisma.vdc.findUnique({ where: { id: vdcId } })
  if (!row) {
    throw new Error(`vDC not found: ${vdcId}`)
  }
  const vdc = rowToVdc(row as VdcRow)

  // 2. Get connection (use the connection's owner tenantId, not the vDC's tenantId)
  const connOwnerTenantId = await getConnectionOwnerTenantId(vdc.connectionId)
  const conn = await getConnectionById(vdc.connectionId, connOwnerTenantId)

  // 3. Fetch pool members
  let members: any[] = []
  try {
    const poolData = await pveFetch<{ members?: any[] }>(conn, `/pools/${encodeURIComponent(vdc.pvePoolName)}`)
    members = poolData?.members || []
  } catch (err: any) {
    console.warn(`[vdc] Failed to fetch pool members for "${vdc.pvePoolName}": ${err?.message}`)
  }

  // 4. Filter for qemu/lxc members, then drop ghosts. PVE pools can hold
  //    references to vmids that no longer exist (VM deleted but the pool
  //    membership wasn't cleaned up — happens when /cluster/resources
  //    races with the delete, or when a tool deleted the VM directly via
  //    qm/pct without going through ProxCenter). Counting them blocks the
  //    vDC delete forever; cross-reference with /cluster/resources and
  //    auto-clean the orphans from the pool.
  let vmMembers = members.filter(
    (m: any) => m.type === 'qemu' || m.type === 'lxc'
  )

  if (vmMembers.length > 0) {
    try {
      const liveResources = await pveFetch<any[]>(conn, '/cluster/resources?type=vm')
      const validIds = new Set(
        (liveResources || [])
          .filter((r: any) => r?.vmid != null)
          .map((r: any) => `${r.type}/${r.vmid}`),
      )
      const ghosts = vmMembers.filter(m => !validIds.has(`${m.type}/${m.vmid}`))
      vmMembers = vmMembers.filter(m => validIds.has(`${m.type}/${m.vmid}`))

      // Best-effort cleanup of ghost references on the PVE pool.
      for (const g of ghosts) {
        try {
          await pveFetch(conn, `/pools/${encodeURIComponent(vdc.pvePoolName)}`, {
            method: 'PUT',
            body: new URLSearchParams({ delete: '1', vms: String(g.vmid) }),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          } as any)
          console.info(`[vdc] cleaned ghost ${g.type}/${g.vmid} from pool "${vdc.pvePoolName}"`)
        } catch (err: any) {
          console.warn(`[vdc] failed to clean ghost ${g.type}/${g.vmid} from pool "${vdc.pvePoolName}": ${err?.message}`)
        }
      }
    } catch (err: any) {
      console.warn(`[vdc] /cluster/resources lookup failed; counting all pool members: ${err?.message}`)
    }
  }

  // 5. Sum resources
  let usedVcpus = 0
  let usedRamMb = 0
  let usedStorageMb = 0
  const usedVms = vmMembers.length
  let usedSnapshots = 0
  let usedBackups = 0

  for (const vm of vmMembers) {
    usedVcpus += vm.maxcpu || 0
    usedRamMb += Math.round((vm.maxmem || 0) / 1048576)
    usedStorageMb += Math.round((vm.maxdisk || 0) / 1048576)
  }

  // Per-tier usage for display (spec §7): same content-listing meter as the
  // enforcement path, stored as JSON on the usage cache row.
  const usedStorageByStorage: Record<string, number> = {}
  const policyRows = await prisma.vdcStoragePolicy.findMany({
    where: { vdcId },
    select: { policy: { select: { storageId: true } } },
  })
  if (policyRows.length > 0 && vmMembers.length > 0) {
    const meterNode = vmMembers[0].node
    const vmids = new Set(vmMembers.map((vm: any) => Number(vm.vmid)))
    for (const pr of policyRows) {
      const usedMb = await getVdcStorageUsedMb(conn, meterNode, pr.policy.storageId, vmids)
      if (usedMb !== null) usedStorageByStorage[pr.policy.storageId] = usedMb
    }
  }

  // 6. Count snapshots per VM (non-"current" entries)
  for (const vm of vmMembers) {
    try {
      const snapshots = await pveFetch<any[]>(
        conn,
        `/nodes/${encodeURIComponent(vm.node)}/${vm.type}/${vm.vmid}/snapshot`
      )
      if (Array.isArray(snapshots)) {
        usedSnapshots += snapshots.filter((s: any) => s.name !== 'current').length
      }
    } catch {
      // Snapshot fetch failed for this VM - skip
    }
  }

  // 7. Count backups across the vDC's PBS bindings.
  const vmidSet = new Set(vmMembers.map(vm => String(vm.vmid)))
  if (vmidSet.size > 0) {
    const bindings = await prisma.vdcPbsNamespace.findMany({
      where: { vdcId },
      select: { pbsConnectionId: true, datastore: true, namespace: true },
    })

    // Group by PBS connection so we authenticate / decrypt once per PBS
    // instead of per binding.
    const byPbs = new Map<string, Array<{ datastore: string; namespace: string }>>()
    for (const b of bindings) {
      const list = byPbs.get(b.pbsConnectionId) || []
      list.push({ datastore: b.datastore, namespace: b.namespace })
      byPbs.set(b.pbsConnectionId, list)
    }

    for (const [pbsId, locations] of byPbs.entries()) {
      try {
        const pbsConn = await prisma.connection.findUnique({
          where: { id: pbsId },
          select: { baseUrl: true, apiTokenEnc: true, insecureTLS: true },
        })
        if (!pbsConn?.apiTokenEnc || !pbsConn?.baseUrl) continue
        const pbsCreds = {
          baseUrl: pbsConn.baseUrl,
          apiToken: decryptSecret(pbsConn.apiTokenEnc),
          insecureDev: !!pbsConn.insecureTLS,
        }
        for (const loc of locations) {
          try {
            const nsParam = loc.namespace ? `?ns=${encodeURIComponent(loc.namespace)}` : ''
            const snaps = await pbsFetch<any[]>(
              pbsCreds,
              `/admin/datastore/${encodeURIComponent(loc.datastore)}/snapshots${nsParam}`,
            )
            if (!Array.isArray(snaps)) continue
            for (const snap of snaps) {
              const backupId = String(snap?.['backup-id'] ?? '')
              if (vmidSet.has(backupId)) usedBackups += 1
            }
          } catch (err: any) {
            console.warn(`[vdc] PBS snapshot list failed for ${pbsId}/${loc.datastore} ns="${loc.namespace}": ${err?.message ?? err}`)
          }
        }
      } catch (err: any) {
        console.warn(`[vdc] PBS connection ${pbsId} skipped during usage refresh: ${err?.message ?? err}`)
      }
    }
  }

  // 8. Upsert into vdc_usage_cache
  const now = new Date()

  await prisma.vdcUsageCache.upsert({
    where: { vdcId },
    update: {
      usedVcpus,
      usedRamMb,
      usedStorageMb,
      usedVms,
      usedSnapshots,
      usedBackups,
      usedStorageByStorage,
      lastSyncedAt: now,
    },
    create: {
      id: randomUUID(),
      vdcId,
      usedVcpus,
      usedRamMb,
      usedStorageMb,
      usedVms,
      usedSnapshots,
      usedBackups,
      usedStorageByStorage,
      lastSyncedAt: now,
    },
  })

  return {
    usedVcpus,
    usedRamMb,
    usedStorageMb,
    usedVms,
    usedSnapshots,
    usedBackups,
    usedStorageByStorage,
    lastSyncedAt: now.toISOString(),
  }
}
