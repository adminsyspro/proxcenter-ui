// Change of the copy rate cap of a warm migration or batch while it runs,
// shared by the migration route and the batch route. The value lives where
// the launch put it: in the job's config for a single migration, on the batch
// row for a batch. The governor of each running copy reads it again within
// one round (copy-rate-governor, 10 s).

import { TERMINAL_STATUSES } from "@/lib/tasks/sharedTask"

import { COPY_RATE_MAX_MBPS, COPY_RATE_MIN_MBPS, parseCopyRateLimit, type CopyRateLimit } from "./copy-rate"
import { jobConfigOf } from "./set-sync-interval"

export const COPY_RATE_VALUE_ERROR = `copyRateLimit must be null (no cap) or { mbps } with mbps 0 (unlimited) or an integer between ${COPY_RATE_MIN_MBPS} and ${COPY_RATE_MAX_MBPS} MB/s, and an optional schedule { from: "HH:MM", to: "HH:MM", tz, offHoursMbps }`
export const COPY_RATE_JOB_ERROR = "Only a warm migration that is not over has a copy rate cap"
export const COPY_RATE_BATCH_JOB_ERROR = "This migration belongs to a batch: change the copy rate cap of the batch"
export const COPY_RATE_BATCH_ERROR = "Only a running or paused batch has a copy rate cap to change"
export const COPY_RATE_FEATURE_ERROR = "The copy rate cap needs the migration feature (Enterprise)"

type JobWriter = { migrationJob: { update: (args: any) => Promise<unknown> } }

/** The cap a request asks for: a cap, `null` for no cap, `undefined` when it is neither. */
export function readRequestedCopyRate(body: unknown): CopyRateLimit | null | undefined {
  const value = (body as { copyRateLimit?: unknown } | null)?.copyRateLimit
  if (value === null) return null
  return parseCopyRateLimit(value) ?? undefined
}

/** A warm migration not over yet, queued jobs included: the value then applies from its first copy. */
export function canSetCopyRate(job: { status: string; config: unknown }): boolean {
  return jobConfigOf(job).migrationType === "warm" && !(TERMINAL_STATUSES as readonly string[]).includes(job.status)
}

export function canSetBatchCopyRate(batch: { status: string }): boolean {
  return batch.status === "running" || batch.status === "paused"
}

/** Write the single migration's own cap, or drop it with `null`. */
export async function setJobCopyRate(prisma: JobWriter, job: { id: string; config: unknown }, limit: CopyRateLimit | null): Promise<void> {
  const { copyRateLimit: _previous, ...rest } = jobConfigOf(job)
  await prisma.migrationJob.update({ where: { id: job.id }, data: { config: limit === null ? rest : { ...rest, copyRateLimit: limit } } })
}
