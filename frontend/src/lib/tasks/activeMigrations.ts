// Type only: sharedTask.ts reaches the database, and this file is read by the
// navbar in the browser.
import type { SharedTask } from "./sharedTask"
import { stepLabelKey } from "./taskProgressDisplay"

/** Same list as TERMINAL_STATUSES in sharedTask.ts (a test keeps them equal). */
export const ENDED_MIGRATION_STATUSES = ["completed", "failed", "cancelled"] as const

/** Migrations that have not ended, oldest first: the order they were started in. */
export function activeMigrations(tasks: SharedTask[]): SharedTask[] {
  return tasks
    .filter(t => !(ENDED_MIGRATION_STATUSES as readonly string[]).includes(t.status))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
}

/**
 * A warm run that waits for the operator to cut over: held on a manual cutover
 * once its first sync has been measured, or parked at the gate of an automatic
 * one that could not meet its budget. Same rule as the batch follow-up
 * (bulkJobsAwaitingCutover).
 */
export function isWaitingForCutover(t: { status: string; cutoverMode?: string | null; projectedDowntimeSec?: number | null }): boolean {
  return t.status === "awaiting_cutover" || (t.status === "delta_sync" && t.cutoverMode === "manual" && t.projectedDowntimeSec != null)
}

export type MigrationStepInput = { status: string; currentStep: string | null; cutoverMode?: string | null; projectedDowntimeSec?: number | null }

/**
 * The step of a migration as the operator reads it, the same on every surface
 * that lists runs (running-tasks menu, task bar, Task Center): "Waiting for
 * cutover" while it waits, the translated step otherwise, a numbered delta pass
 * (delta_19) read as "Delta sync". A step without a translation, such as a
 * virt-v2v phase, is shown as written; null when the run has no step yet.
 */
export function migrationStepText(t: (key: string) => string, m: MigrationStepInput): string | null {
  if (isWaitingForCutover(m)) return t("tasks.shared.waitingForCutover")
  const key = stepLabelKey(m.currentStep)
  if (key) return t(`tasks.steps.${key}`)
  return m.currentStep || null
}

type TaskCenterJob = {
  type?: string
  status?: string
  detail?: string | null
  metadata?: {
    route?: string
    migrationStatus?: string
    currentStep?: string | null
    cutoverMode?: string | null
    projectedDowntimeSec?: number | null
  } | null
}

/**
 * Detail of a Task Center row: for a migration, its route then its step as
 * migrationStepText reads it ("vCenter → pve1 (VMID 118) • Delta sync") rather
 * than the raw step the server puts in `detail`. Any other job is unchanged.
 */
export function migrationJobDetail(t: (key: string) => string, job: TaskCenterJob): string | null | undefined {
  const m = job.metadata
  if (job.type !== "migration" || !m?.route) return job.detail
  const status = m.migrationStatus ?? ""
  if ((ENDED_MIGRATION_STATUSES as readonly string[]).includes(status)) return m.route
  const step = migrationStepText(t, { status, currentStep: m.currentStep ?? null, cutoverMode: m.cutoverMode, projectedDowntimeSec: m.projectedDowntimeSec })
  return step ? `${m.route} • ${step}` : m.route
}
