// src/lib/audit/taskInitiators.ts
//
// Proxmox owns every task ProxCenter starts under the technical API identity
// of the connection, so the PVE task log cannot say which ProxCenter operator
// asked for it (roadmap#41). Routes that start a task journal its UPID in
// `audit_logs.details.upid`; this helper joins a page of tasks back to those
// rows so the Events view can show the human initiator next to the technical
// account, without ever replacing the latter.

import { prisma } from '@/lib/db/prisma'

export interface TaskInitiator {
  userId: string | null
  email: string | null
  apiTokenId: string | null
}

/**
 * Map each UPID to the ProxCenter identity that started it, in ONE query.
 *
 * `tenantId` null means the caller is the provider, which may read the
 * attribution of every tenant. Any other value restricts the lookup to that
 * tenant's own journal, so a tenant never learns which provider operator (or
 * neighbour) touched a guest. `since` bounds the scan on the indexed
 * timestamp column: an audit row is written once the task already exists,
 * never before it started.
 */
export async function findTaskInitiators(
  upids: string[],
  opts: { tenantId: string | null; since: Date },
): Promise<Map<string, TaskInitiator>> {
  const result = new Map<string, TaskInitiator>()
  const unique = [...new Set(upids.filter(Boolean))]
  if (unique.length === 0) return result

  // Prisma's JSON path filter rather than raw SQL: the client carries the
  // DSN's schema, which a raw query would not, and the timestamp bound keeps
  // the scan on the indexed column.
  const rows = await prisma.auditLog.findMany({
    where: {
      timestamp: { gte: opts.since },
      ...(opts.tenantId === null ? {} : { tenantId: opts.tenantId }),
      OR: unique.map(upid => ({ details: { path: ['upid'], equals: upid } })),
    },
    select: { details: true, userId: true, userEmail: true, apiTokenId: true },
    orderBy: { timestamp: 'asc' },
  })

  for (const row of rows) {
    const upid = (row.details as { upid?: unknown } | null)?.upid
    if (typeof upid !== 'string' || result.has(upid)) continue
    if (!row.userId && !row.userEmail && !row.apiTokenId) continue
    result.set(upid, { userId: row.userId, email: row.userEmail, apiTokenId: row.apiTokenId })
  }

  return result
}
