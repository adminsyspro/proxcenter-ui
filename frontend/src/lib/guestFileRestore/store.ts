// src/lib/guestFileRestore/store.ts
//
// Row <-> API shape of a job, plus the two housekeeping passes the read
// routes run: fail the jobs a restart orphaned, drop the ones past retention.

import type { GuestFileRestoreJob as GuestFileRestoreJobRow } from '@prisma/client'

import { prisma } from '@/lib/db/prisma'

import { isJobActive } from './registry'
import { GUEST_FILE_RESTORE_TERMINAL_STATUSES } from './types'
import type {
  GuestFileRestoreJob,
  GuestFileRestoreJobStatus,
  GuestFileRestoreLogLine,
  GuestRestoreConflict,
  GuestRestoreDestination,
  GuestRestoreItem,
  GuestRestoreMethod,
  GuestRestoreSource,
} from './types'

/** A queued/running row untouched for this long with no controller here is an orphan. */
export const STALE_AFTER_MS = 2 * 60_000
export const INTERRUPTED_MESSAGE = 'Interrupted (ProxCenter restarted)'

export function toJobDto(row: GuestFileRestoreJobRow): GuestFileRestoreJob {
  return {
    id: row.id,
    status: row.status as GuestFileRestoreJobStatus,
    method: row.method as GuestRestoreMethod,
    guestOs: (row.guestOs as GuestFileRestoreJob['guestOs']) ?? null,
    connectionId: row.connectionId,
    node: row.node,
    vmid: row.vmid,
    guestType: row.guestType as 'qemu' | 'lxc',
    guestName: row.guestName ?? null,
    source: row.source as unknown as GuestRestoreSource,
    items: (row.items as unknown as GuestRestoreItem[]) ?? [],
    destination: row.destination as unknown as GuestRestoreDestination,
    conflict: row.conflict as GuestRestoreConflict,
    bytesDone: Number(row.bytesDone),
    bytesRead: Number(row.bytesRead),
    bytesTotal: row.bytesTotal === null ? null : Number(row.bytesTotal),
    filesDone: row.filesDone,
    filesSkipped: row.filesSkipped,
    filesFailed: row.filesFailed,
    currentPath: row.currentPath ?? null,
    error: row.error ?? null,
    log: Array.isArray(row.log) ? (row.log as unknown as GuestFileRestoreLogLine[]) : [],
    createdByEmail: row.createdByEmail ?? null,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  }
}

export function isStaleRow(row: Pick<GuestFileRestoreJobRow, 'id' | 'status' | 'updatedAt'>, now = Date.now()): boolean {
  if (row.status !== 'queued' && row.status !== 'running') return false
  if (isJobActive(row.id)) return false
  return now - row.updatedAt.getTime() > STALE_AFTER_MS
}

/**
 * Persist "interrupted" on the orphans among `rows` and return the rows with
 * that verdict applied, so a reader never shows a job as running forever
 * after a restart.
 */
export async function reconcileStaleJobs<T extends GuestFileRestoreJobRow>(rows: T[]): Promise<T[]> {
  const now = Date.now()
  const completedAt = new Date(now)
  const out: T[] = []
  for (const row of rows) {
    if (!isStaleRow(row, now)) {
      out.push(row)
      continue
    }
    const log = Array.isArray(row.log) ? (row.log as unknown as GuestFileRestoreLogLine[]) : []
    const data = {
      status: 'failed',
      error: INTERRUPTED_MESSAGE,
      completedAt,
      log: [...log, { at: completedAt.toISOString(), level: 'error', msg: INTERRUPTED_MESSAGE }].slice(-200),
    }
    try {
      await prisma.guestFileRestoreJob.update({ where: { id: row.id }, data })
    } catch {
      // Already gone or updated by another reader: the local verdict still holds.
    }
    out.push({ ...row, ...data, log: data.log as unknown as T['log'] })
  }
  return out
}

/** Delete the finished jobs of a tenant older than the retention. */
export async function purgeExpiredJobs(tenantId: string, retentionDays: number): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
  const res = await prisma.guestFileRestoreJob.deleteMany({
    where: {
      tenantId,
      createdAt: { lt: cutoff },
      status: { in: [...GUEST_FILE_RESTORE_TERMINAL_STATUSES] },
    },
  })
  return res.count
}
