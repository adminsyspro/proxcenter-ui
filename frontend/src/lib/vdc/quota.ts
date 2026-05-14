// src/lib/vdc/quota.ts
// vDC Quota Check Library
//
// Provides quota enforcement for tenant vDC operations. Both helpers are
// async — Prisma queries against the Postgres-backed vDC schema.

import { DEFAULT_TENANT_ID } from '@/lib/tenant'
import { pveFetch } from '@/lib/proxmox/client'
import { getConnectionById } from '@/lib/connections/getConnection'
import { prisma } from '@/lib/db/prisma'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QuotaOperation {
  type: 'create' | 'clone' | 'resize' | 'config' | 'snapshot' | 'backup'
  addVcpus?: number     // vCPUs requested (create/clone) or delta (config)
  addRamMb?: number     // RAM in MB requested or delta
  addStorageMb?: number // Storage in MB requested or delta
  addVms?: number       // Usually 1 for create/clone, 0 for config/resize
  addSnapshots?: number // 1 for snapshot create, 0 elsewhere
  addBackups?: number   // 1 for backup create, 0 elsewhere
}

export interface QuotaCheckResult {
  allowed: boolean
  violations: string[] // e.g. ["RAM: 252/256 GB, +8 GB exceeds quota"]
  currentUsage: { vcpus: number; ramMb: number; storageMb: number; vms: number; snapshots: number; backups: number }
}

export interface VdcResolveResult {
  vdcId: string
  poolName: string
  quota: {
    maxVcpus: number | null
    maxRamMb: number | null
    maxStorageMb: number | null
    maxVms: number | null
    maxSnapshots: number | null
    maxBackups: number | null
  } | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a value in MB as a human-readable string.
 * Values >= 1024 MB are shown in GB (1 decimal); otherwise in MB.
 */
function formatMb(mb: number): string {
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)} GB`
  }


return `${mb} MB`
}

// ---------------------------------------------------------------------------
// resolveVdcForTenant (async)
// ---------------------------------------------------------------------------

/**
 * Find the vDC for a tenant on a given connection.
 *
 * Returns null when no enforcement should apply:
 * - Default tenant (provider) is never restricted
 * - Tenants with no vDC on this connection are unrestricted
 *
 * Throws `Error('NODE_NOT_AUTHORIZED')` if the node is not in the vDC's
 * allowed node list (caller should catch this specific message).
 */
export async function resolveVdcForTenant(
  tenantId: string,
  connectionId: string,
  node?: string
): Promise<VdcResolveResult | null> {
  // 1. Default tenant = provider, no enforcement
  if (tenantId === DEFAULT_TENANT_ID) return null

  // 2. Find enabled vDC(s) for this tenant on this connection (load quota +
  // node names eagerly to keep this a single round-trip).
  const vdcRows = await prisma.vdc.findMany({
    where: { tenantId, connectionId, enabled: true },
    select: {
      id: true,
      pvePoolName: true,
      quota: true,
      nodes: { select: { nodeName: true } },
    },
  })

  // 3. No vDC found - no enforcement
  if (vdcRows.length === 0) return null

  // 4. Pick first match (future: disambiguate by node when tenant has >1 vDC)
  const vdc = vdcRows[0]

  // 5. If node provided, verify it's in the authorized node list
  if (node && vdc.nodes.length > 0) {
    const authorizedNodes = new Set(vdc.nodes.map(n => n.nodeName))

    if (!authorizedNodes.has(node)) {
      throw new Error('NODE_NOT_AUTHORIZED')
    }
  }

  // 6. Project quota row
  const quota = vdc.quota
    ? {
        maxVcpus: vdc.quota.maxVcpus ?? null,
        maxRamMb: vdc.quota.maxRamMb ?? null,
        maxStorageMb: vdc.quota.maxStorageMb ?? null,
        maxVms: vdc.quota.maxVms ?? null,
        maxSnapshots: vdc.quota.maxSnapshots ?? null,
        maxBackups: vdc.quota.maxBackups ?? null,
      }
    : null

  // 7. Return result
  return {
    vdcId: vdc.id,
    poolName: vdc.pvePoolName,
    quota,
  }
}

// ---------------------------------------------------------------------------
// checkVdcQuota (ASYNC - PVE API call)
// ---------------------------------------------------------------------------

/**
 * Perform a FRESH quota check against PVE pool usage.
 *
 * Queries the PVE pool API to get real-time resource usage, then compares
 * against the configured quota limits for the requested operation.
 */
export async function checkVdcQuota(
  connectionId: string,
  poolName: string,
  quota: VdcResolveResult['quota'],
  operation: QuotaOperation
): Promise<QuotaCheckResult> {
  // 1. No quota configured - allow everything
  if (!quota) {
    return {
      allowed: true,
      violations: [],
      currentUsage: { vcpus: 0, ramMb: 0, storageMb: 0, vms: 0, snapshots: 0, backups: 0 },
    }
  }

  // 2. Resolve the connection's owner tenantId
  const connRecord = await prisma.connection.findUnique({
    where: { id: connectionId },
    select: { tenantId: true },
  })

  if (!connRecord) {
    throw new Error(`Connection not found: ${connectionId}`)
  }

  // 3. Get full connection details for PVE API call
  const conn = await getConnectionById(connectionId, connRecord.tenantId)

  // 4. Fetch pool members from PVE
  let members: any[] = []

  try {
    const poolData = await pveFetch<{ members?: any[] }>(
      conn,
      `/pools/${encodeURIComponent(poolName)}`
    )

    members = poolData?.members || []
  } catch (err: any) {
    // Pool doesn't exist yet (race condition) or unreachable - treat as 0 usage
    console.warn(
      `[vdc/quota] Failed to fetch pool "${poolName}" from PVE: ${err?.message}`
    )
    members = []
  }

  // 5. Filter to qemu/lxc types only
  const vmMembers = members.filter(
    (m: any) => m.type === 'qemu' || m.type === 'lxc'
  )

  // 6. Sum current usage
  let vcpus = 0
  let ramMb = 0
  let storageMb = 0
  const vms = vmMembers.length

  for (const vm of vmMembers) {
    vcpus += vm.maxcpu || 0
    ramMb += Math.round((vm.maxmem || 0) / 1048576)
    storageMb += Math.round((vm.maxdisk || 0) / 1048576)
  }

  // Count snapshots across the pool (only fetched when the operation cares
  // about the snapshot quota — saves ~N PVE calls per ordinary create/resize).
  let snapshots = 0

  if (operation.type === 'snapshot' && quota.maxSnapshots !== null) {
    const snapPromises = vmMembers.map(async (vm: any) => {
      try {
        const resType = vm.type === 'lxc' ? 'lxc' : 'qemu'

        const list = await pveFetch<any[]>(
          conn,
          `/nodes/${encodeURIComponent(vm.node)}/${resType}/${encodeURIComponent(String(vm.vmid))}/snapshot`
        )


        // PVE includes a synthetic "current" entry — exclude it.
        return (list || []).filter((s: any) => s.name !== 'current').length
      } catch { return 0 }
    })

    const counts = await Promise.all(snapPromises)

    snapshots = counts.reduce((acc, n) => acc + n, 0)
  }

  const currentUsage = { vcpus, ramMb, storageMb, vms, snapshots, backups: 0 }

  // 7. Check each quota field against requested operation
  const violations: string[] = []

  const addVcpus = operation.addVcpus ?? 0
  const addRamMb = operation.addRamMb ?? 0
  const addStorageMb = operation.addStorageMb ?? 0
  const addVms = operation.addVms ?? 0

  if (quota.maxVcpus !== null && addVcpus > 0) {
    if (vcpus + addVcpus > quota.maxVcpus) {
      violations.push(
        `vCPUs: ${vcpus}/${quota.maxVcpus} used, +${addVcpus} requested exceeds quota`
      )
    }
  }

  if (quota.maxRamMb !== null && addRamMb > 0) {
    if (ramMb + addRamMb > quota.maxRamMb) {
      violations.push(
        `RAM: ${formatMb(ramMb)}/${formatMb(quota.maxRamMb)} used, +${formatMb(addRamMb)} requested exceeds quota`
      )
    }
  }

  if (quota.maxStorageMb !== null && addStorageMb > 0) {
    if (storageMb + addStorageMb > quota.maxStorageMb) {
      violations.push(
        `Storage: ${formatMb(storageMb)}/${formatMb(quota.maxStorageMb)} used, +${formatMb(addStorageMb)} requested exceeds quota`
      )
    }
  }

  if (quota.maxVms !== null && addVms > 0) {
    if (vms + addVms > quota.maxVms) {
      violations.push(
        `VMs: ${vms}/${quota.maxVms} used, cannot create additional VM`
      )
    }
  }

  const addSnapshots = operation.addSnapshots ?? 0

  if (quota.maxSnapshots !== null && addSnapshots > 0) {
    if (snapshots + addSnapshots > quota.maxSnapshots) {
      violations.push(
        `Snapshots: ${snapshots}/${quota.maxSnapshots} used, cannot create additional snapshot`
      )
    }
  }

  // 8. Return result
  return {
    allowed: violations.length === 0,
    violations,
    currentUsage,
  }
}
