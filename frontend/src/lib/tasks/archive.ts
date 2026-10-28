/**
 * Task archive (#1225): the history Proxmox keeps on every node, read through
 * `/nodes/{node}/tasks?source=all`, where `/cluster/tasks` (the live feed of
 * the Events page and the taskbar) only holds the most recent entries.
 *
 * Pure helpers shared by the archive route and its tests: task families,
 * query parsing, filtering and paging of the merged node lists.
 */

import { extractTaskVmid } from './scope'

export const TASK_FAMILIES = ['power', 'migration', 'ha', 'backup', 'snapshot', 'other'] as const
export type TaskFamily = (typeof TASK_FAMILIES)[number]

export const ARCHIVE_STATUSES = ['all', 'ok', 'warning', 'error', 'running'] as const
export type ArchiveStatus = (typeof ARCHIVE_STATUSES)[number]

export const ARCHIVE_PAGE_SIZES = [20, 50, 100] as const

/** Enough rows to fill a tall card; the list scrolls inside it on a smaller screen. */
export const ARCHIVE_DEFAULT_PAGE_SIZE = 50

/** Longest window one request may read, so a "since 2019" query cannot walk every index. */
export const ARCHIVE_MAX_WINDOW_SEC = 90 * 86400

/** Entries asked of one node; reaching it means the window holds more than we read. */
export const ARCHIVE_NODE_LIMIT = 5000

const POWER = new Set([
  'qmstart', 'qmstop', 'qmshutdown', 'qmreboot', 'qmreset', 'qmsuspend', 'qmresume', 'qmpause',
  'vzstart', 'vzstop', 'vzshutdown', 'vzreboot', 'vzsuspend', 'vzresume',
  'startall', 'stopall', 'suspendall',
])
const MIGRATION = new Set(['qmigrate', 'qmmigrate', 'vzmigrate', 'migrateall', 'qmremotemigrate', 'vzremotemigrate'])
const BACKUP = new Set(['vzdump', 'qmrestore', 'vzrestore'])
const SNAPSHOT = new Set(['qmsnapshot', 'vzsnapshot', 'qmdelsnapshot', 'vzdelsnapshot', 'qmrollback', 'vzrollback'])

/**
 * Family of a PVE task type. HA requests (`hastart`, `hamigrate`, …) form
 * their own family; the guest starts the HA stack runs after a node failure
 * are plain `qmstart`/`vzstart` tasks on the surviving node, hence "power".
 */
export function taskFamily(type: string): TaskFamily {
  if (POWER.has(type)) return 'power'
  if (MIGRATION.has(type)) return 'migration'
  if (type.startsWith('ha')) return 'ha'
  if (BACKUP.has(type)) return 'backup'
  if (SNAPSHOT.has(type)) return 'snapshot'

  return 'other'
}

/** Guest kind a task targets, read from its type prefix. */
export function taskGuestType(type: string): 'qemu' | 'lxc' | null {
  if (type.startsWith('qm')) return 'qemu'
  if (type.startsWith('vz') && type !== 'vzdump') return 'lxc'

  return null
}

export function taskStatusClass(status: string | undefined): Exclude<ArchiveStatus, 'all'> {
  if (!status) return 'running'
  if (status === 'OK') return 'ok'
  if (status.includes('WARNINGS')) return 'warning'

  return 'error'
}

export interface ArchiveQuery {
  since: number
  until: number
  families: TaskFamily[]
  status: ArchiveStatus
  connectionId: string | null
  node: string | null
  vmid: string | null
  search: string
  page: number
  pageSize: number
}

function intParam(value: string | null, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10)

  return Number.isFinite(n) ? n : fallback
}

/**
 * Read the archive query from the URL. Bad values fall back to defaults
 * (last 24 h, every family, first page of 50) rather than failing the request.
 */
export function parseArchiveQuery(params: URLSearchParams, nowSec: number): ArchiveQuery {
  const until = Math.min(intParam(params.get('until'), nowSec), nowSec)
  let since = intParam(params.get('since'), until - 86400)

  if (since >= until) since = until - 86400
  if (until - since > ARCHIVE_MAX_WINDOW_SEC) since = until - ARCHIVE_MAX_WINDOW_SEC

  const familyParam = params.get('families')
  const families = familyParam === null
    ? [...TASK_FAMILIES]
    : familyParam.split(',').filter((f): f is TaskFamily => (TASK_FAMILIES as readonly string[]).includes(f))

  const statusParam = params.get('status') ?? 'all'
  const status = (ARCHIVE_STATUSES as readonly string[]).includes(statusParam) ? (statusParam as ArchiveStatus) : 'all'

  const sizeParam = intParam(params.get('pageSize'), ARCHIVE_DEFAULT_PAGE_SIZE)
  const pageSize = (ARCHIVE_PAGE_SIZES as readonly number[]).includes(sizeParam) ? sizeParam : ARCHIVE_DEFAULT_PAGE_SIZE

  const vmid = params.get('vmid')?.trim() ?? ''

  return {
    since,
    until,
    families,
    status,
    connectionId: params.get('connectionId') || null,
    node: params.get('node') || null,
    vmid: /^\d+$/.test(vmid) ? vmid : null,
    search: (params.get('q') ?? '').trim().toLowerCase(),
    page: Math.max(0, intParam(params.get('page'), 0)),
    pageSize,
  }
}

/** One archived task, already scoped, with what the list needs to render it. */
export interface ArchiveTask {
  id: string
  ts: string
  endTs: string | null
  type: string
  family: TaskFamily
  entity: string | null
  vmid: string | null
  guestName: string | null
  guestType: 'qemu' | 'lxc' | null
  guestStatus: string | null
  node: string
  nodeStatus: string | null
  user: string
  status: string
  statusClass: Exclude<ArchiveStatus, 'all'>
  durationSec: number
  duration: string
  connectionId: string
  connectionName: string
  initiatedBy?: { email: string | null; apiTokenId: string | null }
}

export function matchesArchiveFilters(task: ArchiveTask, q: Pick<ArchiveQuery, 'families' | 'status' | 'search'>): boolean {
  if (!q.families.includes(task.family)) return false
  if (q.status !== 'all' && task.statusClass !== q.status) return false
  if (!q.search) return true

  return [task.type, task.entity, task.guestName, task.node, task.user, task.status, task.connectionName]
    .some(v => v?.toLowerCase().includes(q.search))
}

/**
 * Newest first, one row per UPID: two connections to the same cluster read
 * the same node archives, the UPID names the physical task.
 */
export function mergeArchiveTasks(tasks: ArchiveTask[]): ArchiveTask[] {
  const sorted = [...tasks].sort((a, b) =>
    b.ts.localeCompare(a.ts) || a.connectionId.localeCompare(b.connectionId) || a.id.localeCompare(b.id))
  const seen = new Set<string>()

  return sorted.filter(t => {
    if (seen.has(t.id)) return false
    seen.add(t.id)

    return true
  })
}

export interface ArchiveSummary {
  total: number
  ok: number
  warning: number
  error: number
  running: number
}

export function summarizeArchive(tasks: ArchiveTask[]): ArchiveSummary {
  const summary: ArchiveSummary = { total: tasks.length, ok: 0, warning: 0, error: 0, running: 0 }

  for (const t of tasks) summary[t.statusClass]++

  return summary
}

export function formatTaskDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`

  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`
}

/** PVE node task entry, as `/nodes/{node}/tasks` returns it. */
export interface PveTaskEntry {
  upid: string
  node: string
  starttime: number
  endtime?: number
  type: string
  id?: string
  user: string
  status?: string
}

export function toArchiveTask(
  task: PveTaskEntry,
  ctx: {
    connectionId: string
    connectionName: string
    nowSec: number
    guests: Map<string, { name: string | null; type: 'qemu' | 'lxc' | null; status: string | null }>
    nodeStatus: Map<string, string>
  },
): ArchiveTask {
  const vmid = extractTaskVmid(task.id)
  const guest = vmid ? ctx.guests.get(vmid) : undefined
  const durationSec = Math.max(0, (task.endtime ?? ctx.nowSec) - task.starttime)

  return {
    id: task.upid,
    ts: new Date(task.starttime * 1000).toISOString(),
    endTs: task.endtime ? new Date(task.endtime * 1000).toISOString() : null,
    type: task.type,
    family: taskFamily(task.type),
    entity: task.id || null,
    vmid,
    guestName: guest?.name ?? null,
    guestType: guest?.type ?? (vmid ? taskGuestType(task.type) : null),
    guestStatus: guest?.status ?? null,
    node: task.node,
    nodeStatus: ctx.nodeStatus.get(task.node) ?? null,
    user: task.user,
    status: task.status || 'running',
    statusClass: taskStatusClass(task.status),
    durationSec,
    duration: formatTaskDuration(durationSec),
    connectionId: ctx.connectionId,
    connectionName: ctx.connectionName,
  }
}
