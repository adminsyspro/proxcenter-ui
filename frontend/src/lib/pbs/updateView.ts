// What the backup server update dialog shows, kept apart from the component
// so it can be tested without rendering it.

export interface PbsFinding {
  severity: 'error' | 'warning'
  code: string
  message: string
  context?: Record<string, unknown> | null
}

export interface PbsPackage {
  name: string
  current_version: string
  new_version?: string
}

export interface PbsBackupJobInfo {
  connectionName: string
  id: string
  storage: string
  schedule: string
  nextRun: number | null
}

export interface PbsPreflight {
  can_proceed: boolean
  findings: PbsFinding[]
  version: string
  kernel: string
  updates: { updates_available: boolean, package_count: number, kernel_update: boolean, security_updates: number, packages: PbsPackage[] }
  disk_space_free_bytes: number
  disk_space_total_bytes: number
  running_tasks: { upid: string, worker_type: string, worker_id?: string }[]
  datastores: { name: string, maintenance_mode?: string }[]
  inactive_services: string[]
  reboot_pending: boolean
  /** Packages an interrupted upgrade left unpacked or half configured. */
  pending_configure?: number
  backup_jobs: PbsBackupJobInfo[]
  upcoming_backup_jobs: PbsBackupJobInfo[]
}

export interface PbsRunNode {
  node_name: string
  status: string
  failed_phase?: string
  error?: string
  update_output?: string
  package_progress?: { phase: string, done: number, total: number, unpacked?: number, updated_at: string } | null
  reboot_required?: boolean
  did_reboot?: boolean
  version_before?: string
  version_after?: string
  kernel_before?: string
  kernel_after?: string
  upgraded_packages?: PbsPackage[]
  maintenance_datastores?: string[]
}

export interface PbsRun {
  id: string
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
  error?: string
  created_at?: string
  started_at?: string
  completed_at?: string
  node_statuses?: PbsRunNode[]
  logs?: { timestamp: string, level: string, node?: string, message: string }[]
  config?: { auto_reboot?: boolean, pbs?: { datastore_read_only?: boolean } }
}

export function isRunActive(run: PbsRun | null | undefined): boolean {
  return !!run && (run.status === 'pending' || run.status === 'running' || run.status === 'paused')
}

/** The finding codes the dialog has its own wording for (inventory.pbsUpdate.findings.*). */
export const PBS_FINDING_CODES = [
  'pbs_apt_update_failed',
  'pbs_tasks_running',
  'pbs_disk_space',
  'pbs_disk_space_low',
  'pbs_service_inactive',
  'pbs_no_updates',
  'pbs_state_unreadable',
  'pbs_reboot_pending',
  'pbs_datastore_offline',
  'pbs_dpkg_interrupted',
] as const

/** Whether a run has anything to do: packages to upgrade, or an interrupted upgrade to finish. */
export function needsUpdate(preflight: Pick<PbsPreflight, 'updates' | 'pending_configure'>): boolean {
  return preflight.updates.updates_available || (preflight.pending_configure ?? 0) > 0
}

export function isKnownFinding(code: string): boolean {
  return (PBS_FINDING_CODES as readonly string[]).includes(code)
}

/** Values of a finding as the translations take them: strings and numbers only. */
export function findingValues(finding: PbsFinding): Record<string, string | number> {
  const out: Record<string, string | number> = {}

  for (const [k, v] of Object.entries(finding.context ?? {})) {
    if (typeof v === 'string' || typeof v === 'number') out[k] = v
  }

  return out
}

/** apt's own reason reads "... 401 Unauthorized" when an enterprise repository refuses a server without a subscription. */
export function isSubscriptionRefusal(finding: PbsFinding): boolean {
  return finding.code === 'pbs_apt_update_failed' && /\b401\b|unauthori[sz]ed/i.test(String(finding.context?.error ?? finding.message))
}

export type PbsStep = 'maintenance' | 'upgrade' | 'reboot' | 'verify' | 'release'
export type PbsStepState = 'pending' | 'active' | 'done' | 'failed' | 'skipped'

const STEP_OF_STATUS: Record<string, PbsStep> = {
  entering_maintenance: 'maintenance',
  updating: 'upgrade',
  rebooting: 'reboot',
  waiting_return: 'reboot',
  verifying_health: 'verify',
  exiting_maintenance: 'release',
}

const STEP_ORDER: PbsStep[] = ['maintenance', 'upgrade', 'reboot', 'verify', 'release']

/**
 * The steps of a run with their state. A failed or cancelled node says where
 * it stopped in `failed_phase`.
 */
export function runSteps(run: PbsRun): { step: PbsStep, state: PbsStepState }[] {
  const node = run.node_statuses?.[0]
  const readOnly = !!run.config?.pbs?.datastore_read_only
  const used = (step: PbsStep): boolean => {
    if (step === 'maintenance' || step === 'release') return readOnly
    if (step === 'reboot') return !!node?.did_reboot || (isRunActive(run) && run.config?.auto_reboot !== false)

    return true
  }
  const reached = STEP_OF_STATUS[node?.status ?? ''] ?? STEP_OF_STATUS[node?.failed_phase ?? '']
  const steps = STEP_ORDER.filter(s => used(s) || reached === s)

  if (!node || node.status === 'pending') return steps.map(step => ({ step, state: 'pending' }))
  if (node.status === 'completed') return steps.map(step => ({ step, state: 'done' }))
  if (node.status === 'skipped') return steps.map(step => ({ step, state: 'skipped' }))

  const current = STEP_OF_STATUS[node.status] ?? STEP_OF_STATUS[node.failed_phase ?? ''] ?? steps[0]
  const at = Math.max(0, steps.indexOf(current))
  const failed = node.status === 'failed'

  return steps.map((step, i) => ({
    step,
    state: i < at ? 'done' : i === at ? (failed ? 'failed' : 'active') : 'pending',
  }))
}

/** Share of the run done, for the progress bar: steps done plus apt's own position inside the upgrade. */
export function runPercent(run: PbsRun): number {
  const steps = runSteps(run)

  if (steps.length === 0) return 0
  if (run.status === 'completed') return 100
  const node = run.node_statuses?.[0]
  let done = steps.filter(s => s.state === 'done').length
  const active = steps.find(s => s.state === 'active')

  if (active?.step === 'upgrade' && node?.package_progress && node.package_progress.total > 0) {
    const p = node.package_progress
    const weight = p.phase === 'configure' ? 0.5 + 0.5 * (p.done / p.total) : p.phase === 'unpack' ? 0.5 * (p.done / p.total) : 0

    done += Math.min(1, Math.max(0, weight))
  }

  return Math.round(Math.min(100, (done / steps.length) * 100))
}

/** Seconds a run took, null while it has no end. */
export function runDurationSeconds(run: PbsRun): number | null {
  if (!run.started_at || !run.completed_at) return null
  const ms = Date.parse(run.completed_at) - Date.parse(run.started_at)

  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 1000) : null
}
