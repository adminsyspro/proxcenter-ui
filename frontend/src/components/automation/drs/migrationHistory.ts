// Pure helpers behind the DRS "History" tab: filtering, day grouping and the
// summary strip. Kept free of React so the node test lane can pin them.

/** One DRS migration as the orchestrator persists it (GET /drs/migrations). */
export interface MigrationHistoryEntry {
  id: string
  recommendation_id?: string
  connection_id: string
  vmid: number
  vm_name: string
  guest_type?: 'qemu' | 'lxc'
  source_node: string
  target_node: string
  task_id?: string
  started_at: string
  completed_at?: string | null
  status: 'running' | 'completed' | 'failed'
  error?: string
  /** Why DRS decided the move. Empty on rows written before the orchestrator stored it. */
  reason?: string
  maintenance_evacuation?: boolean
}

export type HistoryStatusFilter = 'all' | 'completed' | 'failed' | 'running'

export interface HistoryFilters {
  /** Connection id, or '' for every cluster. */
  connectionId: string
  status: HistoryStatusFilter
  /** Matched case-insensitively against the guest name and its VMID. */
  search: string
}

export interface HistoryDay {
  /** Local calendar day, YYYY-MM-DD, stable across re-renders for React keys. */
  key: string
  /** Midnight of that day, local time, for the day header. */
  date: Date
  entries: MigrationHistoryEntry[]
}

export interface HistorySummary {
  total: number
  completed: number
  failed: number
  running: number
  /** Mean wall-clock duration of the completed migrations, null when there is none. */
  avgDurationMs: number | null
}

const asTime = (iso: string | null | undefined): number | null => {
  if (!iso) return null
  const t = new Date(iso).getTime()

  return Number.isNaN(t) ? null : t
}

/** Wall-clock duration of a finished migration, null while it runs or when a timestamp is unusable. */
export function migrationDurationMs(entry: MigrationHistoryEntry): number | null {
  const start = asTime(entry.started_at)
  const end = asTime(entry.completed_at)

  if (start === null || end === null || end < start) return null

  return end - start
}

/** Newest first, by completion time when there is one, else by start time. */
export function sortNewestFirst(entries: MigrationHistoryEntry[]): MigrationHistoryEntry[] {
  const stamp = (e: MigrationHistoryEntry) => asTime(e.completed_at) ?? asTime(e.started_at) ?? 0

  return [...entries].sort((a, b) => stamp(b) - stamp(a))
}

export function filterMigrations(entries: MigrationHistoryEntry[], filters: HistoryFilters): MigrationHistoryEntry[] {
  const needle = filters.search.trim().toLowerCase()

  return entries.filter(e => {
    if (filters.connectionId && e.connection_id !== filters.connectionId) return false
    if (filters.status !== 'all' && e.status !== filters.status) return false

    if (needle) {
      const name = (e.vm_name || '').toLowerCase()

      if (!name.includes(needle) && !String(e.vmid).includes(needle)) return false
    }

    return true
  })
}

const dayKeyOf = (d: Date): string => {
  const pad = (n: number) => String(n).padStart(2, '0')

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Groups already-sorted entries by local calendar day, preserving their order
 * inside each day. An entry with an unusable start time lands in a trailing
 * "unknown" group rather than being dropped.
 */
export function groupByDay(entries: MigrationHistoryEntry[]): HistoryDay[] {
  const days: HistoryDay[] = []
  const byKey = new Map<string, HistoryDay>()

  for (const e of entries) {
    const t = asTime(e.started_at)
    const date = t === null ? new Date(0) : new Date(t)
    const key = t === null ? 'unknown' : dayKeyOf(date)
    let day = byKey.get(key)

    if (!day) {
      day = { key, date: new Date(date.getFullYear(), date.getMonth(), date.getDate()), entries: [] }
      byKey.set(key, day)
      days.push(day)
    }

    day.entries.push(e)
  }

  return days
}

export function summarizeMigrations(entries: MigrationHistoryEntry[]): HistorySummary {
  let completed = 0
  let failed = 0
  let running = 0
  let durationSum = 0
  let durationCount = 0

  for (const e of entries) {
    if (e.status === 'completed') {
      completed++
      const d = migrationDurationMs(e)

      if (d !== null) {
        durationSum += d
        durationCount++
      }
    } else if (e.status === 'failed') {
      failed++
    } else if (e.status === 'running') {
      running++
    }
  }

  return {
    total: entries.length,
    completed,
    failed,
    running,
    avgDurationMs: durationCount > 0 ? Math.round(durationSum / durationCount) : null
  }
}

/**
 * Compact duration: "8 s", "1 min 12 s", "2 h 05 min". Unit labels come from
 * the caller so they can be translated; defaults are the SI-style symbols.
 */
export function formatDurationMs(
  ms: number,
  units: { s: string; min: string; h: string } = { s: 's', min: 'min', h: 'h' }
): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) return `${hours} ${units.h} ${String(minutes).padStart(2, '0')} ${units.min}`
  if (minutes > 0) return `${minutes} ${units.min} ${seconds} ${units.s}`

  return `${seconds} ${units.s}`
}
