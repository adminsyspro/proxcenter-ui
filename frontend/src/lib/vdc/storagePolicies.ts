// src/lib/vdc/storagePolicies.ts
// Storage policy domain: input validation, CRUD (with the P2002 -> friendly
// uniqueness message), the delete-in-use guard, the vDC assignment payload
// validator, and the PVE-backed unassign-safety guard.

import { randomUUID } from 'crypto'

import { prisma } from '@/lib/db/prisma'
import { pveFetch } from '@/lib/proxmox/client'

import { clearVdcScopeCache } from './scope'
import type { StoragePolicyDto } from './types'

export interface StoragePolicyInput {
  name: string
  description?: string | null
  storageId: string
  iopsRd?: number | null
  iopsWr?: number | null
  mbpsRd?: number | null
  mbpsWr?: number | null
}

const NAME_MAX = 64
const CAP_FIELDS = ['iopsRd', 'iopsWr', 'mbpsRd', 'mbpsWr'] as const

export function validateStoragePolicyInput(input: StoragePolicyInput): void {
  if (!input.name || typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > NAME_MAX) {
    throw new Error(`Storage policy name is required (1-${NAME_MAX} characters)`)
  }
  if (!input.storageId || typeof input.storageId !== 'string' || !input.storageId.trim()) {
    throw new Error('Storage policy storageId is required')
  }
  for (const f of CAP_FIELDS) {
    const v = input[f]
    if (v === null || v === undefined) continue
    if (!Number.isInteger(v) || v <= 0) {
      throw new Error(`Storage policy ${f} must be a positive integer or null`)
    }
  }
}

/** Server-side validation of the storage backing a policy (spec §8.1):
 *  unlike `primaryStorage`, a storage policy's storage IS validated against
 *  PVE at create/update time. */
export async function assertPolicyStorageValid(conn: any, storageId: string): Promise<void> {
  let config: any
  try {
    config = await pveFetch<any>(conn, `/storage/${encodeURIComponent(storageId)}`)
  } catch {
    throw new Error(`Storage policy storage "${storageId}" not found on this connection`)
  }
  if (!config || !config.shared) {
    throw new Error(`Storage policy storage "${storageId}" must be a shared storage`)
  }
  const content = config.content ? String(config.content).split(',').map((s: string) => s.trim()) : []
  if (!content.includes('images') && !content.includes('rootdir')) {
    throw new Error(`Storage policy storage "${storageId}" must advertise images or rootdir content`)
  }
}

function rowToDto(row: any): StoragePolicyDto {
  return {
    id: row.id,
    connectionId: row.connectionId,
    name: row.name,
    description: row.description ?? null,
    storageId: row.storageId,
    iopsRd: row.iopsRd ?? null,
    iopsWr: row.iopsWr ?? null,
    mbpsRd: row.mbpsRd ?? null,
    mbpsWr: row.mbpsWr ?? null,
    ...(row._count ? { vdcCount: row._count.vdcAssignments } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function listStoragePolicies(connectionId: string): Promise<StoragePolicyDto[]> {
  const rows = await prisma.storagePolicy.findMany({
    where: { connectionId },
    orderBy: { name: 'asc' },
    include: { _count: { select: { vdcAssignments: true } } },
  })
  return rows.map(rowToDto)
}

export async function createStoragePolicy(connectionId: string, input: StoragePolicyInput): Promise<StoragePolicyDto> {
  validateStoragePolicyInput(input)
  const now = new Date()
  try {
    const row = await prisma.storagePolicy.create({
      data: {
        id: randomUUID(),
        connectionId,
        name: input.name.trim(),
        description: input.description ?? null,
        storageId: input.storageId.trim(),
        iopsRd: input.iopsRd ?? null,
        iopsWr: input.iopsWr ?? null,
        mbpsRd: input.mbpsRd ?? null,
        mbpsWr: input.mbpsWr ?? null,
        createdAt: now,
        updatedAt: now,
      },
    })
    return rowToDto(row)
  } catch (err: any) {
    if (err?.code === 'P2002') {
      throw new Error('A storage policy with this name or storage already exists on this connection')
    }
    throw err
  }
}

export async function updateStoragePolicy(policyId: string, input: StoragePolicyInput): Promise<StoragePolicyDto> {
  validateStoragePolicyInput(input)
  try {
    const row = await prisma.storagePolicy.update({
      where: { id: policyId },
      data: {
        name: input.name.trim(),
        description: input.description ?? null,
        storageId: input.storageId.trim(),
        iopsRd: input.iopsRd ?? null,
        iopsWr: input.iopsWr ?? null,
        mbpsRd: input.mbpsRd ?? null,
        mbpsWr: input.mbpsWr ?? null,
        updatedAt: new Date(),
      },
    })
    return rowToDto(row)
  } catch (err: any) {
    if (err?.code === 'P2002') {
      throw new Error('A storage policy with this name or storage already exists on this connection')
    }
    throw err
  }
}

export async function deleteStoragePolicy(policyId: string): Promise<void> {
  const assignments = await prisma.vdcStoragePolicy.findMany({
    where: { policyId },
    select: { vdc: { select: { name: true } } },
  })
  if (assignments.length > 0) {
    const names = assignments.map((a) => `"${a.vdc.name}"`).join(', ')
    throw new Error(`Storage policy is in use by vDC ${names}`)
  }
  await prisma.storagePolicy.delete({ where: { id: policyId } })
}

export async function validateVdcPolicyAssignments(
  connectionId: string,
  assignments: Array<{ policyId: string; quotaMb: number | null }>,
): Promise<void> {
  if (assignments.length === 0) return

  const seen = new Set<string>()
  for (const a of assignments) {
    if (seen.has(a.policyId)) {
      throw new Error(`Storage policy ${a.policyId} is listed twice`)
    }
    seen.add(a.policyId)
  }

  const ids = assignments.map((a) => a.policyId)
  const rows = await prisma.storagePolicy.findMany({
    where: { id: { in: ids } },
    select: { id: true, connectionId: true },
  })
  const byId = new Map(rows.map((r) => [r.id, r.connectionId]))

  for (const a of assignments) {
    const ownerConnectionId = byId.get(a.policyId)
    if (ownerConnectionId === undefined || ownerConnectionId !== connectionId) {
      throw new Error(`Storage policy ${a.policyId} does not belong to this connection`)
    }
    if (a.quotaMb !== null && (!Number.isInteger(a.quotaMb) || a.quotaMb <= 0)) {
      throw new Error('Storage policy quota must be a positive integer (MB) or null')
    }
  }
}

/** Refuse dropping a policy assignment when the vDC still has volumes on
 *  that policy's storage (spec §10). Fail-open on any PVE error: an
 *  unreachable cluster must not block the admin from editing the vDC's
 *  policy set. The residual risk is the orphan documented in spec §6. */
export async function assertPolicyUnassignSafe(
  vdcId: string,
  keptPolicyIds: Set<string>,
  conn: any,
): Promise<void> {
  const vdc = await prisma.vdc.findUnique({
    where: { id: vdcId },
    select: { pvePoolName: true, nodes: { select: { nodeName: true }, take: 1 } },
  })
  if (!vdc) return
  const node = vdc.nodes[0]?.nodeName
  if (!node) return

  const current = await prisma.vdcStoragePolicy.findMany({
    where: { vdcId },
    select: { policyId: true, policy: { select: { name: true, storageId: true } } },
  })
  const removed = current.filter((c) => !keptPolicyIds.has(c.policyId))
  if (removed.length === 0) return

  for (const r of removed) {
    const storage = r.policy.storageId
    let volumes: any[] = []
    let poolVmids: Set<number> = new Set()
    try {
      const content = await pveFetch<any[]>(
        conn,
        `/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/content`,
      ) || []
      volumes = content.filter((v: any) => v.content === 'images' || v.content === 'rootdir')
      if (volumes.length === 0) continue

      const pool = await pveFetch<{ members?: any[] }>(
        conn,
        `/pools/${encodeURIComponent(vdc.pvePoolName)}`,
      )
      poolVmids = new Set((pool?.members || []).map((m: any) => Number(m.vmid)))
    } catch (err: any) {
      console.warn(
        `[vdc/storagePolicies] assertPolicyUnassignSafe check failed for storage "${storage}": ${err?.message ?? err}`,
      )
      continue
    }

    const vmids = Array.from(new Set(
      volumes.map((v: any) => Number(v.vmid)).filter((id: number) => poolVmids.has(id)),
    ))
    if (vmids.length > 0) {
      throw new Error(
        `Cannot remove storage policy "${r.policy.name}": VMs ${vmids.join(', ')} still hold volumes on "${storage}"`,
      )
    }
  }
}

export async function clearScopeCacheForPolicy(policyId: string): Promise<void> {
  const rows = await prisma.vdcStoragePolicy.findMany({
    where: { policyId },
    select: { vdc: { select: { tenantId: true } } },
  })
  const tenantIds = new Set(rows.map((r) => r.vdc.tenantId))
  for (const tenantId of tenantIds) {
    clearVdcScopeCache(tenantId)
  }
}
