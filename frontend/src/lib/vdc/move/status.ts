// Read side of the moves between vDCs (#1335): what the move dialog and the
// task bar poll. A tenant reads its own moves only, and never the raw
// Proxmox error, which can name a node or an address of the target cluster.

import { prisma } from '@/lib/db/prisma'

export interface MoveStatusDto {
  id: string
  guestName: string | null
  vmid: number
  targetVmid: number
  status: string
  origin: string
  sourceVdc: { id: string; name: string | null }
  targetVdc: { id: string; name: string | null }
  sourceConnectionId: string
  targetConnectionId: string
  targetNode: string | null
  error: string | null
  warnings: Array<{ code: string; context?: Record<string, string | number> }>
  createdAt: string
  finishedAt: string | null
}

/** The sentence ProxCenter wrote, without the Proxmox detail appended after ':' or '('. */
export function tenantSafeError(error: string | null): string | null {
  if (!error) return null

  return error.split(/[:(]/)[0].trim().replace(/[;,]$/, '') || 'The move failed'
}

export async function listMoves(opts: { tenantId: string; isProvider: boolean; moveId?: string; activeOnly?: boolean; limit?: number }): Promise<MoveStatusDto[]> {
  const rows = await prisma.vdcMove.findMany({
    where: {
      ...(opts.isProvider ? {} : { tenantId: opts.tenantId }),
      ...(opts.moveId ? { id: opts.moveId } : {}),
      ...(opts.activeOnly ? { status: { in: ['queued', 'copying', 'finalizing'] } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(opts.limit ?? 50, 200),
  })
  const vdcIds = [...new Set(rows.flatMap((r) => [r.sourceVdcId, r.targetVdcId]))]
  const vdcs = vdcIds.length > 0 ? await prisma.vdc.findMany({ where: { id: { in: vdcIds } }, select: { id: true, name: true } }) : []
  const nameOf = new Map(vdcs.map((v) => [v.id, v.name]))

  return rows.map((r) => ({
    id: r.id,
    guestName: r.guestName,
    vmid: r.vmid,
    targetVmid: r.targetVmid,
    status: r.status,
    origin: r.origin,
    sourceVdc: { id: r.sourceVdcId, name: nameOf.get(r.sourceVdcId) ?? null },
    targetVdc: { id: r.targetVdcId, name: nameOf.get(r.targetVdcId) ?? null },
    sourceConnectionId: r.sourceConnectionId,
    targetConnectionId: r.targetConnectionId,
    // The node is the provider's business; the tenant's inventory finds the guest by its vDC.
    targetNode: opts.isProvider ? r.targetNode : null,
    error: opts.isProvider ? r.error : tenantSafeError(r.error),
    warnings: Array.isArray(r.warnings) ? (r.warnings as any[]) : [],
    createdAt: r.createdAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
  }))
}
