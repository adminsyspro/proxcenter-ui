/**
 * Who may see and steer a bulk migration (roadmap#53), and how its rows are
 * returned. Shared by the /api/v1/migrations/batches routes.
 *
 * A batch is read through the tenant-scoped client, so another tenant's batch
 * is simply not found. On top of that the caller must be allowed to migrate
 * between the batch's two clusters right now (canMigrateConnections): a user
 * who lost that right, or a vDC tenant, gets the same bare 404 as for a batch
 * that does not exist, so nothing is learnt about other connections.
 */
import { NextResponse } from "next/server"

import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getCurrentTenantId, getSessionPrisma } from "@/lib/tenant"
import { canMigrateConnections, getTenantInfrastructureScope } from "@/lib/tenant/infraScope"

import { sliceJobLogs } from "./jobLogs"

export interface BatchRow {
  id: string
  tenantId: string
  createdBy: string | null
  sourceConnectionId: string
  targetConnectionId: string
  concurrency: number
  status: string
  createdAt: Date
  updatedAt: Date
}

export type BatchAccess =
  | { ok: true; batch: BatchRow; prisma: Awaited<ReturnType<typeof getSessionPrisma>>; tenantId: string }
  | { ok: false; response: Response }

const notFound = (): BatchAccess => ({ ok: false, response: NextResponse.json({ error: "Migration batch not found" }, { status: 404 }) })

export async function loadBatchForCaller(id: string): Promise<BatchAccess> {
  const denied = await checkPermission(PERMISSIONS.VM_MIGRATE)
  if (denied) return { ok: false, response: denied }
  const prisma = await getSessionPrisma()
  const tenantId = await getCurrentTenantId()
  const batch = await prisma.migrationBatch.findUnique({ where: { id } }) as BatchRow | null
  if (!batch) return notFound()
  if (!canMigrateConnections(await getTenantInfrastructureScope(tenantId), batch.sourceConnectionId, batch.targetConnectionId)) return notFound()
  return { ok: true, batch, prisma, tenantId }
}

/**
 * A migration job as GET /api/v1/migrations/[id] returns it: BigInt counters
 * as numbers, and its log from line `logsAfter` on (the whole log without it,
 * see sliceJobLogs), with `logOffset` and `logCount`.
 */
export function serializeMigrationJob<T extends { bytesTransferred: bigint | null; totalBytes: bigint | null; logs: unknown }>(job: T, logsAfter?: number) {
  return {
    ...job,
    bytesTransferred: job.bytesTransferred ? Number(job.bytesTransferred) : null,
    totalBytes: job.totalBytes ? Number(job.totalBytes) : null,
    ...sliceJobLogs(job.logs, logsAfter),
  }
}

/** Per-state counts of a batch's jobs, for the header of the follow-up dialog. */
export function batchCounts(jobs: Array<{ status: string }>) {
  const counts = { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0 }
  for (const j of jobs) {
    if (j.status === "queued") counts.queued++
    else if (j.status === "completed") counts.completed++
    else if (j.status === "failed") counts.failed++
    else if (j.status === "cancelled") counts.cancelled++
    else counts.running++
  }
  return counts
}

/**
 * The batch and its jobs, in batch order, polled every 3 s by its follow-up.
 * `logsAfter` holds, per job in that order, the lines the caller already has:
 * each job then sends only the rest. A list of another length (not the same
 * jobs) is ignored. The job config is left out (GET /api/v1/migrations/[id]
 * has it).
 */
export async function batchWithJobs(prisma: Awaited<ReturnType<typeof getSessionPrisma>>, batch: BatchRow, logsAfter?: number[]) {
  const jobs = await prisma.migrationJob.findMany({ where: { batchId: batch.id }, omit: { config: true }, orderBy: [{ batchOrder: "asc" }, { createdAt: "asc" }] })
  const after = logsAfter?.length === jobs.length ? logsAfter : undefined
  return { ...batch, counts: batchCounts(jobs), jobs: jobs.map((j, i) => serializeMigrationJob(j, after?.[i])) }
}
