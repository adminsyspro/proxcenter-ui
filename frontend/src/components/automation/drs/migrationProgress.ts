// Pure helper behind the "Migrations in progress" card: the orchestrator names
// the current step of a migration with a code, translated here.

/** The step fields of GET /drs/migrations/{id}/progress. */
export interface MigrationProgressStep {
  message: string
  step?: string
  step_detail?: string
}

// Steps the orchestrator names (drsPage.migrationSteps)
const MIGRATION_STEPS = new Set([
  'pending', 'fetchingStatus', 'inProgress', 'starting', 'analyzingDisks', 'startingDiskCopy',
  'initDiskMirror', 'copying', 'finalSync', 'liveMemory', 'memoryDone', 'completed', 'failed',
])

/**
 * The translated step of a migration, or the orchestrator's message when it
 * names no known step (a raw Proxmox log line, an older orchestrator).
 */
export const migrationProgressMessage = (
  progress: MigrationProgressStep,
  t: (key: string, values?: Record<string, string>) => string
): string => {
  const { step, step_detail: detail } = progress

  if (!step || !MIGRATION_STEPS.has(step)) return progress.message
  const key = step === 'failed' && detail ? 'failedWithReason' : step

  return t(`drsPage.migrationSteps.${key}`, { detail: detail ?? '' })
}
