// src/lib/backups/restoreDrills/display.ts
//
// Pure display rules of the Restore drills tab and dialog: what counts as
// active (drives the polling), durations, the result chip and the cleanup
// badge, the look of a stage or a preflight check. No React here.

import type { Drill, DrillStage, DrillStageStatus, PreflightCheckStatus, Schedule, ScheduleRun } from './types'

export const ACTIVE_POLL_MS = 5000
export const IDLE_POLL_MS = 30_000

const P = 'backups.restoreDrills'

/** The glyph of anything in progress; the UI spins it. */
export const LOADER_ICON = 'ri-loader-4-line'

type ChipColor = 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning'

export interface ChipLook {
  key: string
  color: ChipColor
  values?: Record<string, string>
}

export interface IconLook {
  icon: string
  /** A theme palette path, identical in light and dark. */
  color: string
  key: string
}

export function isDrillRunning(drill: Pick<Drill, 'status'>): boolean {
  return drill.status === 'queued' || drill.status === 'running'
}

/** Running, or its temporary guest is still being removed. */
export function isDrillActive(drill: Pick<Drill, 'status' | 'cleanup_state'>): boolean {
  return isDrillRunning(drill) || drill.cleanup_state === 'pending' || drill.cleanup_state === 'running'
}

export function drillsPollIntervalMs(drills: ReadonlyArray<Pick<Drill, 'status' | 'cleanup_state'>> | null | undefined): number {
  return (drills ?? []).some(isDrillActive) ? ACTIVE_POLL_MS : IDLE_POLL_MS
}

function epoch(value: string | null | undefined): number | null {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) || ms <= 0 ? null : ms
}

/** Whole seconds from `start` to `end` (or to `now` when not ended yet). */
export function secondsBetween(start: string | null | undefined, end: string | null | undefined, now = Date.now()): number | null {
  const from = epoch(start)
  if (from === null) return null
  const to = epoch(end) ?? now
  return Math.max(0, Math.round((to - from) / 1000))
}

export function drillDurationSec(drill: Pick<Drill, 'started_at' | 'finished_at' | 'status'>, now = Date.now()): number | null {
  if (!drill.started_at) return null
  if (!drill.finished_at && !isDrillRunning(drill)) return null
  return secondsBetween(drill.started_at, drill.finished_at, now)
}

export function stageDurationSec(stage: Pick<DrillStage, 'started_at' | 'ended_at' | 'status'>, now = Date.now()): number | null {
  if (!stage.started_at) return null
  if (!stage.ended_at && stage.status !== 'running') return null
  return secondsBetween(stage.started_at, stage.ended_at, now)
}

/** `45s`, `14m 03s`, `2h 05m`; `-` when unknown. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '-'
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s}s`
  const pad = (n: number) => String(n).padStart(2, '0')
  if (s < 3600) return `${Math.floor(s / 60)}m ${pad(s % 60)}s`
  return `${Math.floor(s / 3600)}h ${pad(Math.floor((s % 3600) / 60))}m`
}

export function stageLabelKey(stage: string): string {
  return `${P}.stages.${stage}`
}

/** The step a stage proves, named as an action: "Failed: restore". */
export function stepLabelKey(stage: string): string {
  return `${P}.steps.${stage}`
}

export function statusChip(drill: Pick<Drill, 'status' | 'cancel_requested'>): ChipLook {
  if (drill.status === 'running' && drill.cancel_requested) return { key: `${P}.status.cancelling`, color: 'warning' }
  switch (drill.status) {
    case 'queued': return { key: `${P}.status.queued`, color: 'default' }
    case 'running': return { key: `${P}.status.running`, color: 'info' }
    case 'succeeded': return { key: `${P}.status.succeeded`, color: 'success' }
    case 'failed': return { key: `${P}.status.failed`, color: 'error' }
    case 'cancelled': return { key: `${P}.status.cancelled`, color: 'warning' }
    case 'refused': return { key: `${P}.status.refused`, color: 'error' }
    default: return { key: `${P}.status.queued`, color: 'default' }
  }
}

/**
 * The verdict of a drill. "Boot verified" only on that result; a failure
 * names the stage where it stopped, the localised label is resolved by the
 * caller from `values.stageKey`.
 */
export function resultChip(drill: Pick<Drill, 'result' | 'failed_stage' | 'status'>): (ChipLook & { stageKey?: string }) | null {
  if (drill.result === 'boot_verified') return { key: `${P}.result.bootVerified`, color: 'success' }
  // Runs, but no guest agent proved the OS booted: a warning, never a success.
  if (drill.result === 'vm_started') return { key: `${P}.result.vmStarted`, color: 'warning' }
  if (drill.result === 'cancelled') return { key: `${P}.result.cancelled`, color: 'warning' }
  // Its preflight failed when its turn came: it never ran.
  if (drill.result === 'refused') return { key: `${P}.result.refused`, color: 'error' }
  if (drill.result === 'failed') {
    return drill.failed_stage
      ? { key: `${P}.result.failedAt`, color: 'error', stageKey: stepLabelKey(drill.failed_stage) }
      : { key: `${P}.result.failed`, color: 'error' }
  }
  return null
}

export function cleanupBadge(drill: Pick<Drill, 'cleanup_state'>): ChipLook | null {
  switch (drill.cleanup_state) {
    case 'failed': return { key: `${P}.cleanup.failed`, color: 'error' }
    case 'pending': return { key: `${P}.cleanup.pending`, color: 'info' }
    case 'running': return { key: `${P}.cleanup.running`, color: 'info' }
    case 'done': return { key: `${P}.cleanup.done`, color: 'success' }
    default: return null
  }
}

/** Glyph of the cleanup column: a check once cleaned, a cross when it failed. */
export function cleanupGlyph(drill: Pick<Drill, 'cleanup_state'>): IconLook | null {
  switch (drill.cleanup_state) {
    case 'done': return { icon: 'ri-checkbox-circle-fill', color: 'success.main', key: `${P}.cleanup.done` }
    case 'failed': return { icon: 'ri-close-circle-fill', color: 'error.main', key: `${P}.cleanup.failed` }
    case 'pending': return { icon: 'ri-hourglass-line', color: 'info.main', key: `${P}.cleanup.pending` }
    case 'running': return { icon: LOADER_ICON, color: 'info.main', key: `${P}.cleanup.running` }
    default: return null
  }
}

/** Leading glyph of a drill row. */
export function drillIcon(drill: Pick<Drill, 'status' | 'result'>): IconLook {
  if (drill.status === 'queued') return { icon: 'ri-hourglass-line', color: 'text.secondary', key: `${P}.status.queued` }
  if (drill.status === 'running') return { icon: LOADER_ICON, color: 'info.main', key: `${P}.status.running` }
  if (drill.status === 'refused' || drill.result === 'refused') return { icon: 'ri-forbid-line', color: 'error.main', key: `${P}.status.refused` }
  if (drill.result === 'boot_verified') return { icon: 'ri-lifebuoy-fill', color: 'success.main', key: `${P}.result.bootVerified` }
  if (drill.result === 'vm_started') return { icon: 'ri-lifebuoy-fill', color: 'warning.main', key: `${P}.result.vmStarted` }
  if (drill.status === 'cancelled') return { icon: 'ri-lifebuoy-line', color: 'warning.main', key: `${P}.status.cancelled` }
  return { icon: 'ri-lifebuoy-line', color: 'error.main', key: `${P}.status.failed` }
}

const STAGE_LOOK: Record<DrillStageStatus, Omit<IconLook, 'key'>> = {
  pending: { icon: 'ri-time-line', color: 'text.disabled' },
  running: { icon: LOADER_ICON, color: 'info.main' },
  ok: { icon: 'ri-checkbox-circle-fill', color: 'success.main' },
  failed: { icon: 'ri-close-circle-fill', color: 'error.main' },
  skipped: { icon: 'ri-skip-forward-line', color: 'text.disabled' },
  not_assessed: { icon: 'ri-indeterminate-circle-line', color: 'text.secondary' },
}

/** `not_assessed` is neutral and says so: it is not a pass. */
export function stageLook(status: DrillStageStatus | string): IconLook {
  const look = STAGE_LOOK[status as DrillStageStatus] ?? STAGE_LOOK.pending
  return { ...look, key: `${P}.stageStatus.${status in STAGE_LOOK ? status : 'pending'}` }
}

const CHECK_LOOK: Record<PreflightCheckStatus, Omit<IconLook, 'key'>> = {
  ok: { icon: 'ri-checkbox-circle-fill', color: 'success.main' },
  warn: { icon: 'ri-error-warning-fill', color: 'warning.main' },
  fail: { icon: 'ri-close-circle-fill', color: 'error.main' },
}

export function checkLook(status: PreflightCheckStatus | string): IconLook {
  const known = (status in CHECK_LOOK ? status : 'fail') as PreflightCheckStatus
  return { ...CHECK_LOOK[known], key: `${P}.checkStatus.${known}` }
}

/** Label key of a preflight check; an unknown key is shown raw by the caller. */
export function checkLabelKey(key: string): string {
  return `${P}.checks.${key}`
}

export function canCancel(drill: Pick<Drill, 'status' | 'cancel_requested'>): boolean {
  return isDrillRunning(drill) && !drill.cancel_requested
}

export function canRetryCleanup(drill: Pick<Drill, 'cleanup_state'>): boolean {
  return drill.cleanup_state === 'failed'
}

export function canExportEvidence(drill: Pick<Drill, 'status'>): boolean {
  return drill.status === 'succeeded' || drill.status === 'failed' || drill.status === 'cancelled' || drill.status === 'refused'
}

/** The schedule that queued the drill, or null for a drill started by hand ("Manual"). */
export function drillOrigin(drill: Pick<Drill, 'schedule_id' | 'schedule_name'>): string | null {
  const name = (drill.schedule_name || '').trim()
  if (name) return name
  return drill.schedule_id ? drill.schedule_id.slice(0, 8) : null
}

/** File name of an attachment, from its Content-Disposition header. */
export function filenameFromDisposition(header: string | null | undefined, fallback: string): string {
  if (!header) return fallback
  const star = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(header)
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''))
    } catch {
      /* fall through to the plain parameter */
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header)
  return plain ? plain[1].trim() : fallback
}

/** Stages in the contract order, whatever order the orchestrator stored them in. */
export function orderedStages(stages: DrillStage[] | null | undefined): DrillStage[] {
  const order = ['archive_found', 'restore_completed', 'guest_started', 'guest_agent', 'application_check']
  const rank = (key: string) => {
    const i = order.indexOf(key)
    return i === -1 ? order.length : i
  }
  return [...(stages ?? [])].sort((a, b) => rank(a.key) - rank(b.key))
}

/** Verification state of a PBS snapshot as the contract names it. */
export function snapshotVerifyState(backup: { verified?: boolean; verification?: { state?: string } | null }): 'ok' | 'failed' | 'none' {
  if (backup.verified) return 'ok'
  return backup.verification?.state ? 'failed' : 'none'
}

export interface DrillFormState {
  connId: string
  node: string
  storage: string
  networkMode: 'link_down' | 'bridge'
  bridge: string
  restoreTimeoutSec: number
  bootTimeoutSec: number
  agentTimeoutSec: number
}

export interface SnapshotRow {
  datastore: string
  namespace?: string | null
  backupType: string
  backupId: string | number
  backupTime?: number | null
  backupTimeIso?: string | null
  vmName?: string | null
  size?: number | null
  verified?: boolean
  verification?: { state?: string; 'last-run'?: number } | null
}

/** Body of the preflight and create routes, from a PBS snapshot row and the dialog form. */
export function buildDrillBody(pbsId: string, backup: SnapshotRow, form: DrillFormState) {
  const lastRun = backup.verification?.['last-run']
  let backupTime = backup.backupTimeIso || ''
  if (!backupTime && backup.backupTime) backupTime = new Date(backup.backupTime * 1000).toISOString()
  return {
    pbsId,
    datastore: backup.datastore,
    namespace: backup.namespace || '',
    backupType: backup.backupType,
    backupId: String(backup.backupId),
    backupTime: backupTime.replace(/\.\d{3}Z$/, 'Z'),
    vmName: backup.vmName || '',
    verifyState: snapshotVerifyState(backup),
    verifiedAt: lastRun ? new Date(lastRun * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z') : '',
    backupSize: backup.size || 0,
    targetConnectionId: form.connId,
    targetNode: form.node,
    targetStorage: form.storage,
    networkMode: form.networkMode,
    bridge: form.networkMode === 'bridge' ? form.bridge : '',
    restoreTimeoutSec: form.restoreTimeoutSec,
    bootTimeoutSec: form.bootTimeoutSec,
    agentTimeoutSec: form.agentTimeoutSec,
  }
}

/** Nodes of a cluster that reach the PBS through one of its matching storages. */
export function nodesReachingPbs(
  nodes: ReadonlyArray<string>,
  storages: ReadonlyArray<{ connId: string; nodes: string[] }>,
  connId: string,
): string[] {
  const own = storages.filter(s => s.connId === connId)
  if (own.length === 0) return []
  if (own.some(s => s.nodes.length === 0)) return [...nodes]
  const allowed = new Set(own.flatMap(s => s.nodes))
  return nodes.filter(n => allowed.has(n))
}

// ---------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------

const S = `${P}.schedules`

/** Leading glyph of a schedule row: enabled or not. */
export function scheduleIcon(schedule: Pick<Schedule, 'enabled'>): IconLook {
  return schedule.enabled
    ? { icon: 'ri-calendar-check-line', color: 'success.main', key: `${S}.enabled` }
    : { icon: 'ri-calendar-close-line', color: 'text.disabled', key: `${S}.disabled` }
}

/** Chip of a pass: its result once every drill ended, "Running" before. */
export function runResultChip(run: Pick<ScheduleRun, 'state' | 'result'> | null | undefined): ChipLook | null {
  if (!run) return null
  switch (run.result) {
    case 'ok': return { key: `${S}.runResult.ok`, color: 'success' }
    case 'warning': return { key: `${S}.runResult.warning`, color: 'warning' }
    case 'failed': return { key: `${S}.runResult.failed`, color: 'error' }
    case 'skipped': return { key: `${S}.runResult.skipped`, color: 'default' }
    default:
      if (run.state === 'skipped') return { key: `${S}.runResult.skipped`, color: 'default' }
      return { key: `${S}.runResult.running`, color: 'info' }
  }
}

/** Short scope text: "2 VMs" or "All VMs of <pbs> / <datastore>[ / <namespace>]". */
export function scheduleScopeSummary(schedule: Pick<Schedule, 'scope' | 'source'>): { key: string; values: Record<string, string | number> } {
  if (schedule.scope?.mode === 'vms') {
    return { key: `${S}.scopeVms`, values: { count: schedule.scope.vmids?.length ?? 0 } }
  }
  const src = schedule.source
  const where = [src?.pbs_name || src?.pbs_id, src?.datastore, src?.namespace].filter(Boolean).join(' / ')
  return { key: `${S}.scopeAll`, values: { source: where || '-' } }
}

/**
 * Poll of the schedules list: fast while a drill of the history on screen is
 * active or a pass still runs, the idle interval otherwise.
 */
export function schedulesPollIntervalMs(
  schedules: ReadonlyArray<Pick<Schedule, 'last_run'>> | null | undefined,
  drills: ReadonlyArray<Pick<Drill, 'status' | 'cleanup_state'>> | null | undefined,
): number {
  if (drillsPollIntervalMs(drills) === ACTIVE_POLL_MS) return ACTIVE_POLL_MS
  return (schedules ?? []).some(s => s.last_run?.state === 'running') ? ACTIVE_POLL_MS : IDLE_POLL_MS
}
