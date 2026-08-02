/**
 * Periodic liveness touch for a running migration job (issue #608).
 *
 * The startup orphan sweep (orphan-sweep.ts) uses `updatedAt` age as a liveness
 * signal, but a healthy migration can legitimately write nothing for hours
 * (#606: 2h31 zeroing a 3.1 TB thick warm target with zero log lines). Each
 * pipeline therefore keeps this heartbeat running for the whole job: it bumps
 * `updatedAt` every minute without altering any field the pipeline owns, so
 * silence in the job row genuinely means the process is gone.
 */

import { prisma as globalPrisma } from "@/lib/db/prisma"
import { TERMINAL_STATUSES } from "@/lib/tasks/sharedTask"

export const JOB_HEARTBEAT_INTERVAL_MS = 60_000

/**
 * Minimal surface the heartbeat needs, kept structural on purpose: the
 * pipelines pass the tenant-scoped client from getTenantPrisma(), whose
 * $extends type is not assignable to PrismaClient.
 */
export type JobHeartbeatClient = {
  migrationJob: { updateMany: (args: any) => Promise<unknown> }
}

export interface JobHeartbeatOptions {
  jobId: string
  /** Tenant-scoped client of the calling pipeline; defaults to the global client. */
  prisma?: JobHeartbeatClient
  intervalMs?: number
  /** Observability hook — heartbeat failures are swallowed, never thrown into the pipeline. */
  onError?: (err: unknown) => void
}

/**
 * Start the heartbeat for a job.
 *
 * @returns A stop() function. Safe to call multiple times; pipelines call it in
 *          their `finally` so the heartbeat can never outlive the job.
 */
export function startJobHeartbeat(options: JobHeartbeatOptions): () => void {
  const { jobId, prisma = globalPrisma, intervalMs = JOB_HEARTBEAT_INTERVAL_MS, onError } = options
  let stopped = false
  let inFlight = false

  const touch = () => {
    if (stopped || inFlight) return
    inFlight = true
    // updateMany scoped to the row AND to a non-terminal status: a tick racing
    // the pipeline's terminal write is a no-op, so the heartbeat can never
    // resurrect (or even touch) a finished row. `updatedAt` is @updatedAt, but
    // we set it explicitly so the touch does not depend on that attribute.
    prisma.migrationJob
      .updateMany({
        where: { id: jobId, status: { notIn: [...TERMINAL_STATUSES] } },
        data: { updatedAt: new Date() },
      })
      .then(
        () => {},
        (err) => { try { onError?.(err) } catch { /* observability must never kill the job */ } },
      )
      .finally(() => { inFlight = false })
  }

  const timer = setInterval(touch, intervalMs)
  // Do not keep the Node process alive just for a heartbeat timer.
  if (typeof (timer as any).unref === "function") (timer as any).unref()

  return function stop() {
    if (stopped) return
    stopped = true
    clearInterval(timer)
  }
}
