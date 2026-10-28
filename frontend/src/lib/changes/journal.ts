/**
 * The change journal: what each action looks like, the families the journal
 * filters on, and the reading of a backup row. Shared by the Changes page and
 * the Changes tab of a guest, node or cluster, so both read the same.
 */

import type { ChangeFieldDiff, ChangeRecord } from './csv'

export type JournalChange = ChangeRecord & {
  id: number
  timestamp: string
  connectionId?: string
  source?: string
  taskUpid?: string
  taskStart?: string
  taskEnd?: string
  taskStatus?: string
}

export type ActionColor = 'info' | 'success' | 'error' | 'warning'

export const FAMILIES = ['config', 'hardware', 'network', 'snapshot', 'migration', 'backup'] as const

export type Family = (typeof FAMILIES)[number]

type ActionMeta = { icon: string; color: ActionColor; label: string; family: Family }

export const ACTIONS: Record<string, ActionMeta> = {
  config_changed: { icon: 'ri-settings-3-line', color: 'info', label: 'changes.actionConfigChanged', family: 'config' },
  hardware_changed: { icon: 'ri-cpu-line', color: 'warning', label: 'changes.actionHardwareChanged', family: 'hardware' },
  network_changed: { icon: 'ri-wifi-line', color: 'info', label: 'changes.actionNetworkChanged', family: 'network' },
  snapshot_created: { icon: 'ri-camera-line', color: 'success', label: 'changes.actionSnapshotCreated', family: 'snapshot' },
  snapshot_deleted: { icon: 'ri-camera-off-line', color: 'error', label: 'changes.actionSnapshotDeleted', family: 'snapshot' },
  snapshot_modified: { icon: 'ri-camera-switch-line', color: 'info', label: 'changes.actionSnapshotModified', family: 'snapshot' },
  migrated: { icon: 'ri-swap-box-line', color: 'warning', label: 'changes.actionMigrated', family: 'migration' },
  backup: { icon: 'ri-archive-line', color: 'success', label: 'changes.actionBackup', family: 'backup' },
  created: { icon: 'ri-add-circle-line', color: 'success', label: 'changes.actionCreated', family: 'config' },
  deleted: { icon: 'ri-delete-bin-line', color: 'error', label: 'changes.actionDeleted', family: 'config' },
}

/** A guest's creation or deletion: its rows hold its whole config, not a diff. */
export const LIFECYCLE = new Set(['created', 'deleted'])

/** An action the journal does not know reads as a config change. */
export function actionMeta(action: string | undefined): ActionMeta {
  return ACTIONS[action || ''] || ACTIONS.config_changed
}

export const FAMILY_LABELS: Record<Family, string> = {
  config: 'changes.familyConfig',
  hardware: 'changes.familyHardware',
  network: 'changes.familyNetwork',
  snapshot: 'changes.familySnapshot',
  migration: 'changes.familyMigration',
  backup: 'changes.familyBackup',
}

/**
 * One hue per family, in the validated categorical order, light and dark steps.
 * The row icons and the activity chart share them, so a bar and the rows it
 * stands for read the same.
 */
export const FAMILY_COLORS: Record<Family, { light: string; dark: string }> = {
  config: { light: '#2a78d6', dark: '#3987e5' },
  hardware: { light: '#eb6834', dark: '#d95926' },
  network: { light: '#1baf7a', dark: '#199e70' },
  snapshot: { light: '#eda100', dark: '#c98500' },
  migration: { light: '#e87ba4', dark: '#d55181' },
  backup: { light: '#008300', dark: '#008300' },
}

export type JournalFilter = {
  search?: string
  family?: Family | ''
  resourceType?: string
  user?: string
  /** Epoch ms, inclusive */
  from?: number
  /** Epoch ms, exclusive */
  to?: number
}

/** The changes the filters keep, in the order given. */
export function filterJournal<T extends JournalChange>(changes: readonly T[], filter: JournalFilter): T[] {
  const q = (filter.search || '').trim().toLowerCase()

  return changes.filter(c => {
    if (filter.family && actionMeta(c.action).family !== filter.family) return false
    if (filter.resourceType && c.resourceType !== filter.resourceType) return false
    if (filter.user && c.user !== filter.user) return false
    if (filter.from !== undefined || filter.to !== undefined) {
      const at = new Date(c.timestamp).getTime()

      if (filter.from !== undefined && at < filter.from) return false
      if (filter.to !== undefined && at >= filter.to) return false
    }
    if (!q) return true

    return [c.resourceId, c.resourceName, c.node, c.user, c.connectionName].some(v =>
      String(v ?? '').toLowerCase().includes(q)
    )
  })
}

/** The authors present in the changes, sorted, for the author filter. */
export function journalUsers(changes: readonly JournalChange[]): string[] {
  return [...new Set(changes.map(c => c.user).filter((u): u is string => !!u))].sort((a, b) => a.localeCompare(b))
}

/** Changes on one resource close enough in time to read as one burst. */
export type JournalEntry<T extends JournalChange = JournalChange> = {
  key: string
  /** Newest first */
  changes: T[]
  latest: T
  earliest: T
}

export const BURST_GAP_MS = 30 * 60 * 1000

const time = (c: JournalChange) => new Date(c.timestamp).getTime()

/**
 * The journal as entries: a change on a resource joins that resource's open
 * burst while it lands within `gapMs` of the burst's oldest change, so a run
 * of retries reads as one line. A backup row is already one task and never
 * joins a burst. Entries come newest first, placed at their newest change.
 */
export function groupBursts<T extends JournalChange>(changes: readonly T[], gapMs = BURST_GAP_MS): JournalEntry<T>[] {
  const sorted = [...changes].sort((a, b) => time(b) - time(a))
  const entries: JournalEntry<T>[] = []
  const open = new Map<string, JournalEntry<T>>()

  for (const c of sorted) {
    const resource = `${c.connectionId || c.connectionName}|${c.resourceType}|${c.resourceId}`
    const alone = c.action === 'backup' || LIFECYCLE.has(c.action || '')
    const burst = alone ? undefined : open.get(resource)

    if (burst && time(burst.earliest) - time(c) <= gapMs) {
      burst.changes.push(c)
      burst.earliest = c
      continue
    }

    const entry: JournalEntry<T> = { key: `${resource}|${c.id}`, changes: [c], latest: c, earliest: c }

    entries.push(entry)
    if (!alone) open.set(resource, entry)
    // Before a creation or after a deletion, the ID was another guest's
    else if (LIFECYCLE.has(c.action || '')) open.delete(resource)
  }

  return entries
}

export const PERIODS = ['24h', '7d', '30d', 'all'] as const

export type Period = (typeof PERIODS)[number]

const HOUR = 3600 * 1000
const DAY = 24 * HOUR

const PERIOD_SPAN: Record<Exclude<Period, 'all'>, { span: number; step: number }> = {
  '24h': { span: DAY, step: HOUR },
  '7d': { span: 7 * DAY, step: 6 * HOUR },
  '30d': { span: 30 * DAY, step: DAY },
}

/** Local midnight of the day holding `ms`. */
export function startOfDay(ms: number): number {
  const d = new Date(ms)

  d.setHours(0, 0, 0, 0)

  return d.getTime()
}

export type Bucket = { from: number; to: number; counts: Record<Family, number>; total: number }

/** The local clock slot of `step` holding `ms`: the hour, the quarter day, the day. */
function slotStart(ms: number, step: number): number {
  if (step >= DAY) return startOfDay(ms)

  const d = new Date(ms)
  const hours = step / HOUR

  d.setMinutes(0, 0, 0)
  d.setHours(d.getHours() - (d.getHours() % hours))

  return d.getTime()
}

/**
 * The activity chart's buckets for a period ending `now`: hours over a day,
 * quarter days over a week, days over a month. `all` spans from the oldest
 * change, by day up to two months and by week past that. Buckets sit on local
 * clock slots, the last one holding `now`.
 */
export function bucketize(changes: readonly JournalChange[], period: Period, now: number): Bucket[] {
  let step: number
  let start: number

  if (period === 'all') {
    const oldest = changes.reduce((min, c) => Math.min(min, time(c)), now)

    step = now - oldest > 60 * DAY ? 7 * DAY : DAY
    start = slotStart(oldest, step)
  } else {
    step = PERIOD_SPAN[period].step
    start = periodStart(period, now) as number
  }

  const buckets: Bucket[] = []

  for (let from = start; from <= now; from += step) {
    buckets.push({ from, to: from + step, counts: Object.fromEntries(FAMILIES.map(f => [f, 0])) as Record<Family, number>, total: 0 })
  }

  for (const c of changes) {
    const i = Math.floor((time(c) - start) / step)

    if (i < 0 || i >= buckets.length) continue
    buckets[i].counts[actionMeta(c.action).family]++
    buckets[i].total++
  }

  return buckets
}

/** Where a period's first bucket starts, `undefined` for all of it. */
export function periodStart(period: Period, now: number): number | undefined {
  if (period === 'all') return undefined

  const { span, step } = PERIOD_SPAN[period]

  return slotStart(now, step) - (span / step - 1) * step
}

export type BackupState = 'ok' | 'failed' | 'running' | 'unknown'

export type BackupSummary = {
  state: BackupState
  status?: string
  start?: Date
  end?: Date
  durationSec?: number
}

/**
 * What a backup row says about its task. A task without end is running only
 * while its snapshot is still there: once the snapshot is gone and the end was
 * not seen, the state is unknown rather than a run that never finishes.
 */
export function backupSummary(change: JournalChange): BackupSummary {
  const start = change.taskStart ? new Date(change.taskStart) : undefined
  const end = change.taskEnd ? new Date(change.taskEnd) : undefined

  if (end) {
    const state: BackupState = change.taskStatus === 'OK' ? 'ok' : 'failed'
    const durationSec = start ? Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000)) : undefined

    return { state, status: change.taskStatus, start, end, durationSec }
  }

  return { state: snapshotStillPresent(change.fields) ? 'running' : 'unknown', start }
}

/** Whether the last snapshots diff of a backup row left the vzdump snapshot in place. */
function snapshotStillPresent(fields: ChangeFieldDiff[] | undefined): boolean {
  const snapshots = (fields || []).filter(f => f.field === 'snapshots')

  return !!snapshots.at(-1)?.newValue
}

/** `5 min 54 s`, `1 h 02 min`, `12 s`: compact and unit-labelled by the caller. */
export function formatDuration(totalSec: number, units: { h: string; min: string; s: string }): string {
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60

  if (h > 0) return `${h} ${units.h} ${String(m).padStart(2, '0')} ${units.min}`
  if (m > 0) return `${m} ${units.min} ${String(s).padStart(2, '0')} ${units.s}`

  return `${s} ${units.s}`
}
