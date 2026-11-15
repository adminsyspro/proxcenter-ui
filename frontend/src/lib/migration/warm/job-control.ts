import { getTenantPrisma } from "@/lib/tenant"
import { TERMINAL_STATUSES } from "@/lib/tasks/sharedTask"
import { startOperatorSignalWatch, stopOperatorSignalWatch } from "@/lib/migration/operator-signals"
import type { WarmStatus, LogEntry, WarmLogStep } from "./types"

// ── Job tracking (per-orchestrator, mirrors the other migration pipelines) ──
const cancelledJobs = new Set<string>()
const cutoverRequests = new Set<string>()
// Same shape as cutoverRequests: an operator decision the running pipeline polls
// for. Set when the guest refuses to shut down and the operator chooses to stop
// the source hard rather than wait the deadline out (#614).
const forcePowerOffRequests = new Set<string>()
// A test of the waiting copy asked for, and a request to stop it (migration-test.ts).
const testRequests = new Set<string>()
const testStopRequests = new Set<string>()
// The operator cancelled and asked to remove the copy on the target.
const cancelRemovesTargetJobs = new Set<string>()
const jobPrisma = new Map<string, any>()
// At most one warm job per source VM in-flight. Concurrent warm runs against the
// same VM would interleave snapshots and dd-seek writes (target corruption), so a
// second run for a VM already migrating is rejected (design §12 concurrency lock).
const activeWarmVms = new Set<string>()

/**
 * Bind a job to its tenant Prisma client, drop the previous attempt's operator
 * requests, and start mirroring the durable ones from the job row.
 *
 * The mirror is what makes the sets above trustworthy: a route handler sets
 * them from whichever module instance it was compiled into, which is not
 * necessarily this one, so a click that only reached the route's copy would
 * never be seen here. See lib/migration/operator-signals.
 */
export async function registerJob(jobId: string, prisma: any): Promise<void> {
  jobPrisma.set(jobId, prisma)
  cutoverRequests.delete(jobId)
  forcePowerOffRequests.delete(jobId)
  clearWarmTest(jobId)
  cancelRemovesTargetJobs.delete(jobId)
  await startOperatorSignalWatch(prisma, jobId, signals => {
    // Before the cancel itself: the cleanup the cancel triggers reads it.
    if (signals.cancelRemovesTarget) cancelRemovesTargetJobs.add(jobId)
    if (signals.cancelled) cancelledJobs.add(jobId)
    if (signals.cutover) cutoverRequests.add(jobId)
    if (signals.forcePowerOff) forcePowerOffRequests.add(jobId)
    if (signals.test) testRequests.add(jobId)
    if (signals.testStop) testStopRequests.add(jobId)
  })
}

/** Drop the job's Prisma binding and every per-job signal once the run has ended. */
export function unregisterJob(jobId: string): void {
  stopOperatorSignalWatch(jobId)
  jobPrisma.delete(jobId)
  cancelledJobs.delete(jobId)
  cancelRemovesTargetJobs.delete(jobId)
  cutoverRequests.delete(jobId)
  forcePowerOffRequests.delete(jobId)
  clearWarmTest(jobId)
}

/** Claim the per-source-VM lock; false when another warm run already holds it. */
export function acquireVmLock(vmKey: string): boolean {
  if (activeWarmVms.has(vmKey)) return false
  activeWarmVms.add(vmKey)
  return true
}

export function releaseVmLock(vmKey: string): void { activeWarmVms.delete(vmKey) }

/** Cooperative cancel signal for a warm job (called by the cancel route). */
export function cancelWarmMigrationJob(jobId: string) { cancelledJobs.add(jobId) }
export function isCancelled(jobId: string): boolean { return cancelledJobs.has(jobId) }
/** The cancel to come also removes the copy on the target (called by the cancel route, before the cancel). */
export function requestCancelRemovesTarget(jobId: string) { cancelRemovesTargetJobs.add(jobId) }
/** The job was cancelled, and the operator asked to remove what was copied on the target. */
export function cancelRemovesTarget(jobId: string): boolean { return cancelledJobs.has(jobId) && cancelRemovesTargetJobs.has(jobId) }

/** Cooperative "cutover now" signal for a warm job (called by the cutover route). */
export function requestWarmCutover(jobId: string) { cutoverRequests.add(jobId) }

/** Operator asked to power the source off hard, from the awaiting_power_off wait. */
export function requestWarmForcePowerOff(jobId: string) { forcePowerOffRequests.add(jobId) }

export function isForcePowerOffRequested(jobId: string): boolean { return forcePowerOffRequests.has(jobId) }

/** Operator asked the waiting migration to boot a test VM (called by the test route). */
export function requestWarmTest(jobId: string) { testRequests.add(jobId) }
export function isTestRequested(jobId: string): boolean { return testRequests.has(jobId) }
/** Operator asked the running test to stop. */
export function requestWarmTestStop(jobId: string) { testStopRequests.add(jobId) }
export function isTestStopRequested(jobId: string): boolean { return testStopRequests.has(jobId) }
/**
 * Forget both test signals once a test ended. The engine clears the row
 * first: the mirror would otherwise put them back on its next read.
 */
export function clearWarmTest(jobId: string) {
  testRequests.delete(jobId)
  testStopRequests.delete(jobId)
}

/** Test seam, mirrors __isCutoverRequestedForTest. */
export function __isForcePowerOffRequestedForTest(jobId: string): boolean { return isForcePowerOffRequested(jobId) }
export function isCutoverRequested(jobId: string): boolean { return cutoverRequests.has(jobId) }
/** @internal test hook */
export function __isCutoverRequestedForTest(jobId: string): boolean { return isCutoverRequested(jobId) }

/**
 * Move a job to a status. The write that ends a run (completed, failed,
 * cancelled) always lands. A step of a run still working does not land on a
 * row the operator cancelled meanwhile: the cancel route writes the row, the
 * pipeline only reads it on the next poll of its signals, and a progress write
 * in between used to put the migration back to "delta_sync", so it kept
 * syncing behind a task shown as stopped until a second cancel got through.
 */
export async function updateJob(id: string, status: WarmStatus, extra: Record<string, any> = {}) {
  const prisma = jobPrisma.get(id)
  const data = { status, currentStep: status, ...(status === "completed" ? { completedAt: new Date() } : {}), ...extra }
  if ((TERMINAL_STATUSES as readonly string[]).includes(status)) {
    await prisma.migrationJob.update({ where: { id }, data })
    return
  }
  await prisma.migrationJob.updateMany({ where: { id, status: { not: "cancelled" } }, data })
}

/**
 * Throttled live-progress write, fired from an SSH onData callback that is not
 * awaited by the pipeline. updateMany scoped to a non-terminal status: a
 * straggler flush racing the terminal write in the catch must never resurrect a
 * completed/failed/cancelled row (#608 — same guard as the job heartbeat).
 */
export async function updateJobLive(id: string, status: WarmStatus, extra: Record<string, any> = {}) {
  const prisma = jobPrisma.get(id)
  await prisma.migrationJob.updateMany({
    where: { id, status: { notIn: [...TERMINAL_STATUSES] } },
    data: { status, currentStep: status, ...extra },
  })
}

/**
 * Write fields of a job that is still running without touching its status or
 * its step: a figure the engine derives on the side (the suggested sync
 * interval) must not move what the follow-up shows. Scoped to a non-terminal
 * status like updateJobLive, so it never writes on a job that has ended.
 */
export async function updateJobFields(id: string, data: Record<string, any>) {
  const prisma = jobPrisma.get(id)
  await prisma.migrationJob.updateMany({ where: { id, status: { notIn: [...TERMINAL_STATUSES] } }, data })
}

/**
 * The job's persisted config as it is NOW, not as the pipeline received it:
 * the cutover route writes the operator's guest-conversion choice into it
 * (#1000), from whichever module instance served the click.
 */
export async function readJobConfig(id: string): Promise<Record<string, any>> {
  const prisma = jobPrisma.get(id)
  const job = await prisma?.migrationJob.findUnique({ where: { id }, select: { config: true } })
  const config = job?.config
  return config && typeof config === "object" && !Array.isArray(config) ? config as Record<string, any> : {}
}

/**
 * Write what a test of the waiting copy reports (migration-test.ts), whatever
 * the job's status: a test ended by a cancellation still has to say so on a
 * row the cancel route already made terminal. Only test fields go through
 * here, never the status.
 */
export async function updateJobTestFields(id: string, data: { testState?: unknown; testRequest?: null; testStopRequestedAt?: null }) {
  const prisma = jobPrisma.get(id)
  await prisma.migrationJob.updateMany({ where: { id }, data })
}

/** The test the operator asked for, as the route wrote it on the row (migration-test-state.ts parses it). */
export async function readJobTestRequest(id: string): Promise<unknown> {
  const prisma = jobPrisma.get(id)
  const job = await prisma?.migrationJob.findUnique({ where: { id }, select: { testRequest: true } })
  return job?.testRequest ?? null
}

export async function appendLog(id: string, msg: string, level: LogEntry["level"] = "info", extra: Partial<LogEntry> = {}) {
  const prisma = jobPrisma.get(id)
  const job = await prisma.migrationJob.findUnique({ where: { id }, select: { logs: true, progress: true } })
  const logs: LogEntry[] = (job?.logs as LogEntry[] | null) ?? []
  logs.push({ ts: new Date().toISOString(), msg, level, progress: job?.progress ?? 0, ...extra } as any)
  await prisma.migrationJob.update({ where: { id }, data: { logs } })
}

/**
 * Open a phase of the job log (#1000): one `step` entry the dialogs render as
 * a section header. `title` is the English text kept for the copied log and
 * for any reader that does not know the step.
 */
export async function appendStep(id: string, step: WarmLogStep, title: string) {
  await appendLog(id, title, "step", { step })
}

const OPERATOR_GATE_TIMEOUT_MS = 2 * 60 * 60 * 1000 // 2h safety cap

/**
 * Wait between two hold passes, in slices, so the operator's cutover request is
 * picked up within a second instead of after the full interval. A converged
 * source yields empty passes in seconds; without this pause the hold would
 * snapshot and consolidate on vCenter in a tight loop for its whole duration,
 * which is exactly the churn that broke a 3 TB run (#678). How long the pause
 * lasts is an operator setting (./sync-interval), applied by ./hold-wait. Returns false
 * when a cutover was requested (the caller stops replicating and switches over),
 * true when the wait ran to the end. Throws on cancellation, like every other
 * wait in this pipeline.
 */
export async function sleepUnlessCutover(jobId: string, ms: number): Promise<boolean> {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (isCancelled(jobId)) throw new Error("Migration cancelled")
    if (isCutoverRequested(jobId)) return false
    await new Promise(r => setTimeout(r, Math.max(1, Math.min(1000, until - Date.now()))))
  }
  return true
}

/**
 * How many pre-cutover delta passes may fail back to back before the job gives
 * up, and how long to wait between two attempts. A field run replicated 2.4 TB
 * for 20 hours of manual hold and died on pass 102 because one SSH command to
 * the node missed its 30 s budget (#1028): nothing was wrong with the copy,
 * yet the whole migration had to restart from the full copy.
 */
export const DELTA_PASS_MAX_ATTEMPTS = 5
export const DELTA_PASS_RETRY_DELAY_MS = 60 * 1000

/**
 * Run one delta pass that happens BEFORE the cutover, retrying it when it fails.
 *
 * Safe because a pass only moves the baseline forward once it has fully
 * succeeded: a failed attempt leaves the previous changeId (or XAPI snapshot)
 * in place, so the next attempt asks for everything changed since that
 * baseline, a superset of whatever the failed attempt had half written. The
 * source is still running at this stage, so waiting costs no downtime. The
 * cutover pass itself must NOT go through here: the guest is off by then.
 *
 * Returns the pass result, or null when the operator requested cutover during
 * a retry wait (the caller proceeds to the final delta from the last good
 * baseline). Cancellation, and the last failure once the attempts are spent,
 * are thrown.
 */
export async function runDeltaPassWithRetry<T>(
  jobId: string, passLabel: string, run: () => Promise<T>,
  opts: { maxAttempts?: number; delayMs?: number } = {},
): Promise<T | null> {
  const maxAttempts = opts.maxAttempts ?? DELTA_PASS_MAX_ATTEMPTS
  const delayMs = opts.delayMs ?? DELTA_PASS_RETRY_DELAY_MS
  for (let attempt = 1; ; attempt++) {
    try {
      return await run()
    } catch (e: any) {
      if (isCancelled(jobId)) throw e
      const msg = e?.message || String(e)
      if (attempt >= maxAttempts) {
        throw new Error(`${passLabel} failed ${attempt} times in a row, last error: ${msg}`)
      }
      await appendLog(jobId, `${passLabel} failed (attempt ${attempt} of ${maxAttempts}): ${msg}. The copy on the target is intact; retrying in ${Math.round(delayMs / 1000)}s from the last completed pass`, "warn")
      if (!(await sleepUnlessCutover(jobId, delayMs))) return null
    }
  }
}

/** Test seam: the hold pacing is otherwise only reachable through a full run. */
export function __sleepUnlessCutoverForTest(jobId: string, ms: number): Promise<boolean> {
  return sleepUnlessCutover(jobId, ms)
}

/**
 * Why the gate was reached, stated from the numbers rather than assumed.
 *
 * Every projection carries a fixed floor (shutdown + boot) that no amount of
 * converging can shave off, so a budget set below that floor can never be met
 * and the run parks at the gate even when the deltas are empty. Blaming the
 * source there is simply false — a 0.0 MB delta pass is the opposite of "the
 * source is changing faster than it converges" — so say which of the two it is.
 *
 * Exported for the unit test; `floorSec` unknown (older callers) keeps the
 * historical wording.
 */
export function gateReason(budgetSec: number, floorSec?: number): string {
  return floorSec != null && budgetSec < floorSec
    ? `The ${budgetSec}s budget is below the ~${floorSec}s floor every cutover carries (shutdown + boot), so no delta pass can ever meet it.`
    : "The source is changing faster than it converges."
}

/**
 * Pause a warm job at the operator gate: persist the estimate, log an actionable
 * message, then wait until the operator requests cutover (resolve), cancels
 * (throw "Migration cancelled"), or the safety timeout elapses (throw). No delta
 * passes run while waiting; only the SOAP session stays alive (keepalive).
 */
export async function awaitOperatorCutover(
  jobId: string, projectedDowntimeSec: number, budgetSec: number, maxPasses: number,
  opts: { pollMs?: number; timeoutMs?: number; floorSec?: number } = {},
): Promise<void> {
  const pollMs = opts.pollMs ?? 3000
  const timeoutMs = opts.timeoutMs ?? OPERATOR_GATE_TIMEOUT_MS
  await updateJob(jobId, "awaiting_cutover", { currentStep: "awaiting_cutover", projectedDowntimeSec })
  const mins = Math.round(projectedDowntimeSec / 60)
  await appendLog(jobId, `Reached ${maxPasses} delta passes; projected cutover downtime ~${projectedDowntimeSec}s (~${mins} min) exceeds the ${budgetSec}s budget. ${gateReason(budgetSec, opts.floorSec)} Click "Cutover now" to proceed (VM offline ~${mins} min), or cancel and use a cold migration.`, "warn")
  const start = Date.now()
  while (true) {
    if (isCancelled(jobId)) throw new Error("Migration cancelled")
    if (isCutoverRequested(jobId)) { await appendLog(jobId, "Operator requested cutover — proceeding to final delta", "info"); return }
    if (Date.now() - start > timeoutMs) throw new Error(`Operator gate timed out after ${Math.round(timeoutMs / 3600000)}h with no cutover decision; the job was left paused too long`)
    await new Promise(r => setTimeout(r, pollMs))
  }
}

/** @internal test hook */
export function __awaitOperatorCutoverForTest(
  jobId: string, projectedDowntimeSec: number, budgetSec: number, maxPasses: number,
  opts: { pollMs?: number; timeoutMs?: number },
): Promise<void> {
  jobPrisma.set(jobId, getTenantPrisma("default"))
  return awaitOperatorCutover(jobId, projectedDowntimeSec, budgetSec, maxPasses, opts)
}
