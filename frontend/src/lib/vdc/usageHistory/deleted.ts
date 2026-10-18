// Usage history of deleted vDCs (#902). The history table has no foreign key
// on the vDC: once a vDC is deleted its samples stay until the retention purges
// them, so its last month can still be invoiced and its consumption proven.
// They are found by vdc_id, and identified by the columns copied on each row.

import { prisma } from '@/lib/db/prisma'

import type { VdcSampleIdentity } from './sampler'

export interface DeletedVdcHistory {
  vdcId: string
  vdcName: string
  tenantId: string
  tenantName: string
  firstSampledAt: string
  lastSampledAt: string
  samples: number
}

/** Identity of a vDC as its most recent sample recorded it, or null without history. */
export async function findHistoryIdentity(vdcId: string): Promise<VdcSampleIdentity | null> {
  const row = await prisma.vdcUsageSample.findFirst({
    where: { vdcId },
    orderBy: { sampledAt: 'desc' },
    select: { vdcId: true, vdcName: true, tenantId: true, tenantName: true, connectionId: true, pvePoolName: true },
  })

  if (!row) return null

  return {
    id: row.vdcId,
    name: row.vdcName,
    tenantId: row.tenantId,
    tenantName: row.tenantName,
    connectionId: row.connectionId,
    pvePoolName: row.pvePoolName,
  }
}

/**
 * The deleted vDCs that still have samples, most recently sampled first.
 * `tenantId` restricts the list to the vDCs of one tenant.
 */
export async function listDeletedVdcHistories(tenantId?: string): Promise<DeletedVdcHistory[]> {
  const live = await prisma.vdc.findMany({ select: { id: true } })
  const groups = await prisma.vdcUsageSample.groupBy({
    by: ['vdcId'],
    where: { vdcId: { notIn: live.map(v => v.id) }, ...(tenantId ? { tenantId } : {}) },
    _count: { _all: true },
    _min: { sampledAt: true },
    _max: { sampledAt: true },
  })

  const out: DeletedVdcHistory[] = []

  for (const g of groups) {
    const identity = await findHistoryIdentity(g.vdcId)

    if (!identity || !g._min.sampledAt || !g._max.sampledAt) continue
    out.push({
      vdcId: g.vdcId,
      vdcName: identity.name,
      tenantId: identity.tenantId,
      tenantName: identity.tenantName,
      firstSampledAt: g._min.sampledAt.toISOString(),
      lastSampledAt: g._max.sampledAt.toISOString(),
      samples: g._count._all,
    })
  }

  return out.sort((a, b) => b.lastSampledAt.localeCompare(a.lastSampledAt))
}
