/**
 * Place of a warm migration that waits for a manual cutover.
 *
 * Such a job can wait for days. If it kept its batch slot and its share of the
 * cluster, node and source-host limits all along, a wave would stop at
 * `concurrency` replicated VMs and never seed the others. So it gives its
 * place back while it sleeps between two delta passes (`holdIdleAt` on its
 * row, which the batch scheduler reads) and takes one again before each pass,
 * under the same locks and the same limits as a job that starts: a pass
 * snapshots the source and runs a reader on the target node like any copy, so
 * a hundred waiting VMs must not sync all at once.
 *
 * Seeding goes first: giving a place back pumps the job's batch, and a waiting
 * job leaves a free place to the queued VMs of a running batch, for at most
 * HOLD_QUEUE_YIELD_INTERVALS more intervals so it still syncs during a long
 * wave. Without that bound the waiting jobs, which ask every few seconds,
 * would take every place before the scheduler's next pass and stall the wave.
 *
 * Cutovers queue among themselves only: a requested cutover never waits behind
 * the copies of a wave, but a hundred cutovers asked at once run as many at a
 * time as the node and source-host limits allow. The source VM is still up
 * while a cutover waits its turn, so the wait costs no downtime.
 *
 * Nothing here may fail a migration that only waits: a database error while
 * giving a place back or taking one is retried, never thrown (#1028).
 */
import { prisma } from "@/lib/db/prisma"
import { lockLimitScope, sourceLimitScope, targetLimitScope } from "@/lib/migration/limit-locks"
import { effectiveMigrationLimits, hasFreeSlot, sourceHostKey } from "@/lib/migration/migration-limits"
import { TERMINAL_STATUSES } from "@/lib/tasks/sharedTask"

import { isCancelled, isCutoverRequested, sleepUnlessCutover } from "./job-control"

const QUEUED_STATUS = "queued"

/** Pause between two attempts to take a place back when the limits are full. */
export const HOLD_RECLAIM_RETRY_MS = 5000

/** Intervals a waiting job leaves a free place to queued VMs before it syncs anyway. */
export const HOLD_QUEUE_YIELD_INTERVALS = 3

/**
 * Give the job's place back: it holds no slot and counts against no limit
 * until reclaimed. The job's batch is pumped so a queued VM takes the place
 * now instead of at the scheduler's next pass. The scheduler is imported on
 * demand: it imports the pipelines, which import this module.
 */
export async function releaseHoldSlot(jobId: string): Promise<void> {
  await prisma.migrationJob.updateMany({ where: { id: jobId }, data: { holdIdleAt: new Date() } })
  const job = await prisma.migrationJob.findUnique({ where: { id: jobId }, select: { batchId: true } })
  const batchId = job?.batchId
  if (batchId) {
    void import("@/lib/migration/batch-scheduler")
      .then(m => m.pumpBatch(batchId))
      .catch(err => console.error(`[migration-hold] pump of batch ${batchId} failed:`, err))
  }
}

/** Take the place back whatever the limits say. */
export async function forceHoldSlot(jobId: string): Promise<void> {
  await prisma.migrationJob.updateMany({ where: { id: jobId }, data: { holdIdleAt: null } })
}

type SlotMode = "pass" | "pass-after-queue" | "cutover"

/**
 * Take the job's place back if there is room, under the limit locks, so two
 * jobs never take the same last place, nor does a batch start a job into it at
 * the same time. False when there is none: the caller waits and tries again.
 * - "pass": the cluster, node and source-host limits, counting every running job.
 * - "pass-after-queue": the same, and no VM of a running batch into the same
 *   cluster may be queued.
 * - "cutover": the same limits, counting only the jobs whose cutover was
 *   requested, so cutovers queue among themselves and never behind copies.
 */
async function reclaim(jobId: string, mode: SlotMode): Promise<boolean> {
  return prisma.$transaction(async tx => {
    const job = await tx.migrationJob.findUnique({
      where: { id: jobId },
      select: { targetConnectionId: true, targetNode: true, sourceConnectionId: true, config: true },
    })
    if (!job) throw new Error("Migration job not found")
    await lockLimitScope(tx, targetLimitScope(job.targetConnectionId))
    await lockLimitScope(tx, sourceLimitScope(job.sourceConnectionId))
    const [target, source] = await Promise.all([
      tx.connection.findUnique({ where: { id: job.targetConnectionId }, select: { migrationMaxParallel: true, migrationMaxPerNode: true } }),
      tx.connection.findUnique({ where: { id: job.sourceConnectionId }, select: { type: true, migrationMaxPerSourceHost: true } }),
    ])
    const active = await tx.migrationJob.findMany({
      where: {
        id: { not: jobId },
        status: { notIn: [QUEUED_STATUS, ...TERMINAL_STATUSES] },
        holdIdleAt: null,
        ...(mode === "cutover" && { cutoverRequestedAt: { not: null } }),
        OR: [{ targetConnectionId: job.targetConnectionId }, { sourceConnectionId: job.sourceConnectionId }],
      },
      select: { targetConnectionId: true, targetNode: true, sourceConnectionId: true, config: true },
    })
    const hostKey = (j: { sourceConnectionId: string; config: unknown }) =>
      j.sourceConnectionId === job.sourceConnectionId ? sourceHostKey(j.sourceConnectionId, j.config) : null
    const free = hasFreeSlot(
      { targetNode: job.targetNode, sourceHostKey: hostKey(job) },
      active.map(j => ({ targetNode: j.targetNode, sourceHostKey: hostKey(j), sameTarget: j.targetConnectionId === job.targetConnectionId })),
      effectiveMigrationLimits(target, source),
    )
    if (!free) return false
    if (mode === "pass-after-queue") {
      const queued = await tx.migrationJob.findFirst({
        where: { status: QUEUED_STATUS, targetConnectionId: job.targetConnectionId, batch: { status: "running" } },
        select: { id: true },
      })
      if (queued) return false
    }
    await tx.migrationJob.updateMany({ where: { id: jobId }, data: { holdIdleAt: null } })
    return true
  })
}

/**
 * Take the job's place back for a delta pass if the limits leave room; with
 * `yieldToQueue`, only when no VM of a running batch into the same cluster is
 * still queued.
 */
export function reclaimHoldSlot(jobId: string, opts: { yieldToQueue?: boolean } = {}): Promise<boolean> {
  return reclaim(jobId, opts.yieldToQueue ? "pass-after-queue" : "pass")
}

/** How often a sleeping job reads its interval again, so a change reaches it mid-sleep. */
export const HOLD_INTERVAL_RECHECK_MS = 30_000

/** The interval of a hold: a number of seconds, or a reader asked again during the sleep. It must not throw. */
export type HoldInterval = number | (() => Promise<number>)

export interface HoldOptions {
  /** Pause between two readings of the interval during the sleep (HOLD_INTERVAL_RECHECK_MS). */
  intervalRecheckMs?: number
  /** Pause between two attempts to take a place back (HOLD_RECLAIM_RETRY_MS). */
  reclaimRetryMs?: number
  /** Called once when the limits are full after the sleep, so the job log can say why no pass runs. */
  onWaitForSlot?: () => void | Promise<void>
  /** Called once when a requested cutover waits behind the cutovers already running. */
  onWaitForCutoverSlot?: () => void | Promise<void>
}

/** A database error while a migration only waits is logged and read as "not now". */
async function quietly<T>(what: string, jobId: string, run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run()
  } catch (e: any) {
    console.warn(`[migration-hold] job ${jobId}: ${what} failed, will retry: ${e?.message || e}`)
    return fallback
  }
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/**
 * Take a place for a requested cutover: at once unless the node or the source
 * host already runs as many cutovers as its limit, then when one of them ends.
 */
async function takeCutoverSlot(jobId: string, retryMs: number, opts: HoldOptions): Promise<void> {
  let told = false
  while (!(await quietly("taking a place for the cutover", jobId, () => reclaim(jobId, "cutover"), false))) {
    if (isCancelled(jobId)) throw new Error("Migration cancelled")
    if (!told) { told = true; await opts.onWaitForCutoverSlot?.() }
    await sleep(retryMs)
  }
}

/**
 * Sleep the interval, counted from now. A reader is asked again every
 * `recheckMs`: an interval shortened meanwhile ends the sleep as soon as it is
 * over, a longer one extends it. False when a cutover was requested.
 */
async function sleepInterval(jobId: string, interval: HoldInterval, firstSec: number, recheckMs: number): Promise<boolean> {
  const started = Date.now()
  let sec = firstSec
  for (;;) {
    const left = started + sec * 1000 - Date.now()
    if (left <= 0) return true
    if (!(await sleepUnlessCutover(jobId, typeof interval === "number" ? left : Math.min(left, recheckMs)))) return false
    if (typeof interval !== "number") sec = await interval()
  }
}

/**
 * Wait between two delta passes of a manual hold: give the place back, sleep
 * the interval, take a place again. "pass" when the next pass may run,
 * "cutover" once the operator asked for it and the cutover has its place.
 * Throws on cancellation, like every wait of the pipeline. The job holds its
 * place again when this returns.
 */
export async function holdBetweenPasses(jobId: string, interval: HoldInterval, opts: HoldOptions = {}): Promise<"pass" | "cutover"> {
  const retryMs = opts.reclaimRetryMs ?? HOLD_RECLAIM_RETRY_MS
  // A cutover asked during the pass that just ended: no reason to go idle.
  if (isCutoverRequested(jobId)) return "cutover"
  const intervalSec = typeof interval === "number" ? interval : await interval()
  // A place that cannot be given back is simply kept for this sleep.
  const released = await quietly("giving the place back", jobId, async () => { await releaseHoldSlot(jobId); return true }, false)
  const yieldUntil = Date.now() + (1 + HOLD_QUEUE_YIELD_INTERVALS) * intervalSec * 1000
  try {
    if (!(await sleepInterval(jobId, interval, intervalSec, opts.intervalRecheckMs ?? HOLD_INTERVAL_RECHECK_MS))) { await takeCutoverSlot(jobId, retryMs, opts); return "cutover" }
    let told = false
    while (released && !(await quietly("taking the place back", jobId, () => reclaimHoldSlot(jobId, { yieldToQueue: Date.now() < yieldUntil }), false))) {
      if (!told) { told = true; await opts.onWaitForSlot?.() }
      if (!(await sleepUnlessCutover(jobId, retryMs))) { await takeCutoverSlot(jobId, retryMs, opts); return "cutover" }
    }
    if (isCancelled(jobId)) throw new Error("Migration cancelled")
    if (isCutoverRequested(jobId)) return "cutover"
    return "pass"
  } catch (e) {
    // Cancelled or failed: the row turns terminal and counts nowhere, but the
    // marker must not outlive the wait.
    await forceHoldSlot(jobId).catch(() => {})
    throw e
  }
}
