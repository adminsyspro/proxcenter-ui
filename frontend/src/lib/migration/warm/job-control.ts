import { getTenantPrisma } from "@/lib/tenant"
import { TERMINAL_STATUSES } from "@/lib/tasks/sharedTask"
import type { WarmStatus, LogEntry } from "./types"

// ── Job tracking (per-orchestrator, mirrors the other migration pipelines) ──
const cancelledJobs = new Set<string>()
const cutoverRequests = new Set<string>()
// Same shape as cutoverRequests: an operator decision the running pipeline polls
// for. Set when the guest refuses to shut down and the operator chooses to stop
// the source hard rather than wait the deadline out (#614).
const forcePowerOffRequests = new Set<string>()
const jobPrisma = new Map<string, any>()
// At most one warm job per source VM in-flight. Concurrent warm runs against the
// same VM would interleave snapshots and dd-seek writes (target corruption), so a
// second run for a VM already migrating is rejected (design §12 concurrency lock).
const activeWarmVms = new Set<string>()

/** Bind a job to its tenant Prisma client and clear stale operator requests before a run. */
export function registerJob(jobId: string, prisma: any): void {
  jobPrisma.set(jobId, prisma)
  cutoverRequests.delete(jobId)
  forcePowerOffRequests.delete(jobId)
}

/** Drop the job's Prisma binding and every per-job signal once the run has ended. */
export function unregisterJob(jobId: string): void {
  jobPrisma.delete(jobId)
  cancelledJobs.delete(jobId)
  cutoverRequests.delete(jobId)
  forcePowerOffRequests.delete(jobId)
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

/** Cooperative "cutover now" signal for a warm job (called by the cutover route). */
export function requestWarmCutover(jobId: string) { cutoverRequests.add(jobId) }

/** Operator asked to power the source off hard, from the awaiting_power_off wait. */
export function requestWarmForcePowerOff(jobId: string) { forcePowerOffRequests.add(jobId) }

export function isForcePowerOffRequested(jobId: string): boolean { return forcePowerOffRequests.has(jobId) }

/** Test seam, mirrors __isCutoverRequestedForTest. */
export function __isForcePowerOffRequestedForTest(jobId: string): boolean { return isForcePowerOffRequested(jobId) }
export function isCutoverRequested(jobId: string): boolean { return cutoverRequests.has(jobId) }
/** @internal test hook */
export function __isCutoverRequestedForTest(jobId: string): boolean { return isCutoverRequested(jobId) }

export async function updateJob(id: string, status: WarmStatus, extra: Record<string, any> = {}) {
  const prisma = jobPrisma.get(id)
  await prisma.migrationJob.update({
    where: { id },
    data: { status, currentStep: status, ...(status === "completed" ? { completedAt: new Date() } : {}), ...extra },
  })
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

export async function appendLog(id: string, msg: string, level: LogEntry["level"] = "info") {
  const prisma = jobPrisma.get(id)
  const job = await prisma.migrationJob.findUnique({ where: { id }, select: { logs: true, progress: true } })
  const logs: LogEntry[] = (job?.logs as LogEntry[] | null) ?? []
  logs.push({ ts: new Date().toISOString(), msg, level, progress: job?.progress ?? 0 } as any)
  await prisma.migrationJob.update({ where: { id }, data: { logs } })
}

const OPERATOR_GATE_TIMEOUT_MS = 2 * 60 * 60 * 1000 // 2h safety cap

/**
 * Pacing between two delta passes of a manual hold. A converged source yields
 * empty passes in seconds; without this the hold would snapshot and consolidate
 * on vCenter in a tight loop for its whole duration, which is exactly the churn
 * that broke a 3 TB run (#678). Deliberately not configurable: it only changes
 * how fresh the projection is, and a minute is fresh enough to decide on.
 */
export const HOLD_PASS_INTERVAL_MS = 60 * 1000

/**
 * Wait between two hold passes, in slices, so the operator's cutover request is
 * picked up within a second instead of after the full interval. Returns false
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
