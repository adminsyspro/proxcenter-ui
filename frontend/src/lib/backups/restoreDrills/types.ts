// src/lib/backups/restoreDrills/types.ts
//
// Shapes of the orchestrator restore-drill API (roadmap#35). JSON is
// snake_case, times are RFC 3339 UTC. The orchestrator owns the data; the UI
// only authorises, resolves the PBS archive volid and displays.

export type DrillNetworkMode = 'link_down' | 'bridge'
export type DrillVerifyState = 'ok' | 'failed' | 'none'
/** `refused`: a queued drill whose preflight failed when its turn came (it never ran). */
export type DrillStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'refused'
export type DrillPhase = 'restoring' | 'configuring' | 'booting' | 'agent' | 'screenshot' | 'cleaning' | 'done'
export type DrillResult = 'boot_verified' | 'vm_started' | 'failed' | 'cancelled' | 'refused' | ''
export type DrillCleanupState = 'none' | 'pending' | 'running' | 'done' | 'failed'
export type DrillStageKey = 'archive_found' | 'restore_completed' | 'guest_started' | 'guest_agent' | 'application_check'
export type DrillStageStatus = 'pending' | 'running' | 'ok' | 'failed' | 'skipped' | 'not_assessed'
export type PreflightCheckStatus = 'ok' | 'fail' | 'warn'
/** '' = not attempted (the guest never started, or a drill older than the capture). */
export type DrillScreenshotState = '' | 'captured' | 'unavailable'

export const PREFLIGHT_CHECK_KEYS = [
  'license', 'guest_type', 'connection', 'node_online', 'archive_found', 'disk_sizes',
  'target_storage', 'free_space', 'budget', 'concurrency', 'vmid', 'network',
] as const

export const DRILL_STAGE_KEYS: readonly DrillStageKey[] = [
  'archive_found', 'restore_completed', 'guest_started', 'guest_agent', 'application_check',
]

export interface DrillSource {
  pbs_id: string
  pbs_name: string
  pbs_storage: string
  datastore: string
  namespace: string
  backup_type: string
  backup_id: string
  backup_time: string
  vm_name: string
  verify_state: DrillVerifyState
  verified_at: string
  backup_size_bytes: number
  /** Only on a stored drill. */
  archive?: string
}

export interface DrillRequest {
  connection_id: string
  node: string
  target_storage: string
  archive: string
  network_mode: DrillNetworkMode
  bridge: string
  restore_timeout_sec: number
  boot_timeout_sec: number
  agent_timeout_sec: number
  source: DrillSource
  requested_by: string
}

export interface PreflightCheck {
  key: string
  status: PreflightCheckStatus
  detail: string
}

export interface Preflight {
  ok: boolean
  required_bytes: number
  temp_vmid: number
  checks: PreflightCheck[]
}

export interface DrillStage {
  key: DrillStageKey | string
  status: DrillStageStatus
  started_at: string
  ended_at: string
  detail: string
}

export interface Drill {
  id: string
  status: DrillStatus
  phase: DrillPhase | string
  result: DrillResult
  failed_stage: string
  error: string
  cleanup_state: DrillCleanupState
  cleanup_error: string
  connection_id: string
  node: string
  target_storage: string
  network_mode: DrillNetworkMode | string
  bridge: string
  source: DrillSource
  temp_vmid: number
  temp_name: string
  required_bytes: number
  restore_timeout_sec: number
  boot_timeout_sec: number
  agent_timeout_sec: number
  stages: DrillStage[]
  /** Console capture after the stabilization delay: information only, never part of the verdict. */
  screenshot_state: DrillScreenshotState
  screenshot_at: string
  screenshot_error: string
  cancel_requested: boolean
  requested_by: string
  /** '' for a drill started by hand. */
  schedule_id?: string
  /** The schedule name when the drill was created ('' = manual): kept after the schedule is deleted. */
  schedule_name?: string
  /** When the drill waited for a free slot, '' otherwise. */
  queued_at?: string
  created_at: string
  started_at: string
  finished_at: string
  cleaned_at: string
}

export interface DrillEvent {
  ts: string
  level: 'info' | 'warning' | 'error'
  stage: string
  message: string
}

export interface DrillSettings {
  max_concurrent: number
  capacity_budget_gb: number
  free_space_margin_pct: number
  restore_timeout_sec: number
  boot_timeout_sec: number
  agent_timeout_sec: number
  default_network_mode: DrillNetworkMode
  default_bridge: string
  screenshot_delay_sec: number
}

/** Inclusive ranges the orchestrator enforces on the settings row. */
export const SETTINGS_RANGES = {
  max_concurrent: [1, 10],
  capacity_budget_gb: [0, 1_000_000],
  free_space_margin_pct: [0, 100],
  restore_timeout_sec: [300, 86_400],
  boot_timeout_sec: [60, 3600],
  agent_timeout_sec: [30, 1800],
  screenshot_delay_sec: [0, 600],
} as const satisfies Record<string, readonly [number, number]>

export type SettingsRangeKey = keyof typeof SETTINGS_RANGES

// ---------------------------------------------------------------------------
// Schedules (addendum 4): recurring passes that queue drills on a rotation.
// ---------------------------------------------------------------------------

export type ScheduleScopeMode = 'vms' | 'all'
export type ScheduleRestorePoint = 'latest' | 'latest_verified'
export type ScheduleRunState = 'running' | 'done' | 'skipped'
export type ScheduleRunResult = 'ok' | 'warning' | 'failed' | 'skipped' | ''

export const SCHEDULE_RESTORE_POINTS: readonly ScheduleRestorePoint[] = ['latest', 'latest_verified']

/** Bounds the orchestrator enforces on a schedule. */
export const SCHEDULE_LIMITS = {
  nameMax: 100,
  vmidsMax: 500,
  vmsPerRun: [1, 50],
} as const

export interface ScheduleScope {
  mode: ScheduleScopeMode
  vmids: number[]
}

export interface ScheduleSource {
  pbs_id: string
  pbs_name: string
  /** PVE storage id of the target connection that reaches this PBS datastore and namespace. */
  pbs_storage: string
  datastore: string
  namespace: string
}

export interface ScheduleInput {
  name: string
  enabled: boolean
  scope: ScheduleScope
  restore_point: ScheduleRestorePoint
  source: ScheduleSource
  connection_id: string
  node: string
  target_storage: string
  network_mode: DrillNetworkMode
  bridge: string
  /** PVE calendar event, the subset the orchestrator evaluates. */
  calendar: string
  vms_per_run: number
  created_by: string
}

export interface ScheduleSkippedVm {
  vmid: number
  reason: string
}

export interface ScheduleRun {
  id: string
  schedule_id: string
  started_at: string
  state: ScheduleRunState
  result: ScheduleRunResult
  summary: string
  drill_ids: string[]
  skipped_vmids: ScheduleSkippedVm[]
}

export interface Schedule extends ScheduleInput {
  id: string
  rotation_last_vmid: number
  /** '' (or null) when disabled. */
  next_run_at: string | null
  last_run: ScheduleRun | null
  created_at: string
  updated_at: string
}
