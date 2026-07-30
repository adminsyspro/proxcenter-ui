// Startup sweep for migration jobs orphaned by a server restart (#608).
// Pipelines run in an unsupervised after() continuation of the POST request,
// so a process death mid-transfer leaves the row non-terminal forever and the
// task bar shows a dead job as "In progress" indefinitely.
import os from "node:os"

import type { PrismaClient } from "@prisma/client"

import { TERMINAL_STATUSES } from "@/lib/tasks/sharedTask"

// A live migration can legitimately be silent for hours (#606: 2h31 spent
// zeroing a thick warm target without emitting a single log line), so a row we
// do not own is only swept once it has been silent longer than any plausible
// step. Jobs heartbeat while they run, so this bound is about a dead writer,
// not about a slow one.
export const FOREIGN_ORPHAN_MAX_AGE_MS = 12 * 60 * 60 * 1000

// Status is "failed" (not "cancelled") so the existing retry route accepts it.
export const ORPHANED_JOB_ERROR =
  "Migration interrupted: the ProxCenter server running this job stopped (restart, upgrade or crash). It did not complete and can be retried."

/** Stable identity of this server across restarts: same per host, distinct per HA replica. */
export function resolveInstanceId(): string {
  // Never process.env.HOSTNAME: the Dockerfile pins it to 0.0.0.0 so Next's
  // standalone server binds every interface, so every replica would answer the
  // same identity and each boot would sweep its live peers' jobs.
  // os.hostname() is the node hostname under the HA compose (host networking)
  // and the container id otherwise; PROXCENTER_INSTANCE_ID overrides it for
  // deployments that want an identity surviving container recreation. It must
  // be unique per running instance.
  return process.env.PROXCENTER_INSTANCE_ID || os.hostname()
}

export interface OrphanSweepResult {
  owned: number
  foreign: number
  total: number
}

/**
 * Fail migration jobs that can no longer be running:
 * - non-terminal rows owned by `instanceId` — we are just booting, so a row
 *   owned by our own previous incarnation cannot still be running;
 * - non-terminal rows owned by nobody (created before owner tagging existed)
 *   or by another instance, once they have been silent for longer than
 *   FOREIGN_ORPHAN_MAX_AGE_MS. Both cases matter: os.hostname() is the
 *   container id on a single-node install, so an image upgrade turns our own
 *   previous rows into foreign ones, and without this branch they would stay
 *   non-terminal forever. The age bound is what keeps the sweep from killing a
 *   live migration running on a peer replica.
 */
export async function sweepOrphanedMigrationJobs(deps: {
  prisma: Pick<PrismaClient, "migrationJob">
  instanceId: string
  now?: Date
}): Promise<OrphanSweepResult> {
  const { prisma, instanceId, now = new Date() } = deps
  const nonTerminal = { notIn: [...TERMINAL_STATUSES] }
  // currentStep tracks status everywhere else (pipelines, cancel route).
  const failure = {
    status: "failed",
    currentStep: "failed",
    error: ORPHANED_JOB_ERROR,
    completedAt: now,
  }

  const owned = await prisma.migrationJob.updateMany({
    where: { ownerInstanceId: instanceId, status: nonTerminal },
    data: failure,
  })
  const foreign = await prisma.migrationJob.updateMany({
    where: {
      // Spelled out rather than `{ not: instanceId }`: on a nullable column
      // that comparison drops the NULL rows, which are exactly the legacy ones.
      OR: [{ ownerInstanceId: null }, { ownerInstanceId: { not: instanceId } }],
      status: nonTerminal,
      updatedAt: { lt: new Date(now.getTime() - FOREIGN_ORPHAN_MAX_AGE_MS) },
    },
    data: failure,
  })

  return { owned: owned.count, foreign: foreign.count, total: owned.count + foreign.count }
}
