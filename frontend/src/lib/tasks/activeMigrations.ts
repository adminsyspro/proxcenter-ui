// Type only: sharedTask.ts reaches the database, and this file is read by the
// navbar in the browser.
import type { SharedTask } from "./sharedTask"

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
export function isWaitingForCutover(t: Pick<SharedTask, "status" | "cutoverMode" | "projectedDowntimeSec">): boolean {
  return t.status === "awaiting_cutover" || (t.status === "delta_sync" && t.cutoverMode === "manual" && t.projectedDowntimeSec != null)
}
