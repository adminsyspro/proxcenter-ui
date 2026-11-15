// Change of the interval between two syncs on a migration that already waits,
// shared by the single route and the batch one. The value lives in the job's
// config, where the launch put it: the engine reads the row again while the
// job sleeps (hold-wait), and a retry replays it.

import { TERMINAL_STATUSES } from "@/lib/tasks/sharedTask"

import { SYNC_INTERVAL_MAX_SEC, SYNC_INTERVAL_MIN_SEC, parseSyncInterval } from "./sync-interval"

export const SYNC_INTERVAL_VALUE_ERROR = `syncIntervalSec must be an integer between ${SYNC_INTERVAL_MIN_SEC} and ${SYNC_INTERVAL_MAX_SEC} seconds, or null for the setting of the source connection`
export const SYNC_INTERVAL_JOB_ERROR = "Only a warm migration that waits for a manual cutover has an interval between two syncs"

type JobWriter = { migrationJob: { update: (args: any) => Promise<unknown> } }

interface IntervalJob {
  id: string
  status: string
  cutoverRequestedAt: Date | null
  config: unknown
}

export function jobConfigOf(job: { config: unknown }): Record<string, any> {
  const config = job.config
  return config && typeof config === "object" && !Array.isArray(config) ? config as Record<string, any> : {}
}

/**
 * The value a request asks for: a number inside the bounds, `null` to go back
 * to the setting of the source connection, `undefined` when it is neither.
 */
export function readRequestedSyncInterval(body: unknown): number | null | undefined {
  const value = (body as { syncIntervalSec?: unknown } | null)?.syncIntervalSec
  if (value === null) return null
  if (typeof value !== "number") return undefined
  return parseSyncInterval(value) ?? undefined
}

/**
 * Whether the interval still means something for this job: a warm migration
 * launched with a manual cutover, not over, whose cutover was not asked yet. A
 * queued job of a batch qualifies, the value then applies from its first hold.
 */
export function canSetSyncInterval(job: IntervalJob): boolean {
  const config = jobConfigOf(job)
  return config.migrationType === "warm" && config.cutoverMode === "manual"
    && !(TERMINAL_STATUSES as readonly string[]).includes(job.status) && job.cutoverRequestedAt == null
}

/** Write the job's own interval, or drop it with `null`. */
export async function setJobSyncInterval(prisma: JobWriter, job: IntervalJob, syncIntervalSec: number | null): Promise<void> {
  const { syncIntervalSec: _previous, ...rest } = jobConfigOf(job)
  await prisma.migrationJob.update({ where: { id: job.id }, data: { config: syncIntervalSec === null ? rest : { ...rest, syncIntervalSec } } })
}
