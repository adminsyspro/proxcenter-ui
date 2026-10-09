// src/lib/backups/coverage.ts
// Backup coverage resolver (roadmap#48): which guests no PVE backup job
// (vzdump, /cluster/backup) would ever back up.
//
// Pure on purpose: the route feeds it the guest inventory, the raw jobs and
// the creation times it could find, so every selection rule is unit-tested
// without a cluster. The selection mirrors PVE::VZDump::get_included_guests:
//   - `pool` wins over `vmid`, which wins over `all` (only one is honoured);
//   - `exclude` only applies to an `all` job;
//   - `node` restricts ANY job to the guests currently on that node;
//   - a job with `enabled: 0` never runs, so it covers nothing.

export type CoverageGuest = {
  connId: string
  connectionName?: string
  node: string
  /** Status of the node, for the row's node glyph; not used by the resolver. */
  nodeStatus?: string
  vmid: string
  type: string
  name: string
  status?: string
  template?: boolean
  tags?: string[]
  pool?: string | null
}

/** A /cluster/backup entry as PVE returns it; only the selection fields matter here. */
export type VzdumpJob = {
  id?: string
  enabled?: number | boolean | string
  all?: number | boolean | string
  exclude?: string
  vmid?: string
  pool?: string
  node?: string
}

export type CoverageSettings = {
  /** Hours a freshly created guest may stay uncovered before it is listed. 0 lists it at once. */
  graceHours: number
  /** A guest carrying this PVE tag is deliberately left out of backups. Empty disables the opt-out. */
  excludeTag: string
}

export const DEFAULT_COVERAGE_SETTINGS: CoverageSettings = { graceHours: 24, excludeTag: 'no-backup' }

/** Alert threshold keys holding the coverage settings, shared with the orchestrator. */
export const COVERAGE_GRACE_KEY = 'backup_coverage_grace_hours'
export const COVERAGE_TAG_KEY = 'backup_coverage_exclude_tag'
/** 0/1 switch of the orchestrator alert, one per uncovered guest. */
export const COVERAGE_ALERTS_KEY = 'backup_coverage_alerts'

/** One year: past that, a grace period is a disabled check in disguise. */
export const MAX_GRACE_HOURS = 8760

/** PVE's own tag syntax (pve-tag in PVE::JSONSchema), lowercase only here. */
const PVE_TAG_RE = /^[a-z0-9_][a-z0-9_+.-]*$/

export function normalizeGraceHours(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return DEFAULT_COVERAGE_SETTINGS.graceHours
  return Math.min(MAX_GRACE_HOURS, Math.max(0, Math.trunc(n)))
}

/** Lowercased tag, or '' when empty. Returns null for a value PVE would refuse as a tag. */
export function normalizeExcludeTag(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const tag = raw.trim().toLowerCase()
  if (tag === '') return ''
  return PVE_TAG_RE.test(tag) ? tag : null
}

/** Reads the coverage settings out of the stored alert thresholds, defaults for anything missing. */
export function coverageSettingsFromThresholds(raw: unknown): CoverageSettings {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const grace = obj[COVERAGE_GRACE_KEY]
  const tag = normalizeExcludeTag(obj[COVERAGE_TAG_KEY])
  return {
    graceHours: grace === undefined ? DEFAULT_COVERAGE_SETTINGS.graceHours : normalizeGraceHours(grace),
    excludeTag: tag ?? DEFAULT_COVERAGE_SETTINGS.excludeTag,
  }
}

export type UncoveredReason = 'no_job' | 'not_selected' | 'excluded' | 'other_node' | 'disabled_job'

export type UncoveredGuest = CoverageGuest & {
  reason: UncoveredReason
  /** The jobs behind the reason: the excluding, node-restricted or disabled ones. */
  jobIds: string[]
  /** Unix seconds, when a creation time could be found. */
  createdAt: number | null
}

export type CoverageSummary = {
  /** Guests checked, templates left aside. */
  total: number
  covered: number
  uncovered: number
  ignored: { template: number; tag: number; grace: number }
}

export type CoverageResult = { uncovered: UncoveredGuest[]; summary: CoverageSummary }

type Selection = 'selected' | 'excluded' | 'other_node' | 'not_selected'

function truthy(v: unknown): boolean {
  return v === 1 || v === true || v === '1'
}

function splitList(v: unknown): string[] {
  if (typeof v !== 'string') return []
  return v.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean)
}

/** A job without `enabled` is enabled: PVE only writes the key to switch it off. */
export function isJobEnabled(job: VzdumpJob): boolean {
  if (job.enabled === undefined || job.enabled === null) return true
  return truthy(job.enabled)
}

/** How a single job treats a guest, enabled or not. */
export function jobSelection(job: VzdumpJob, guest: CoverageGuest): Selection {
  const onNode = (): Selection => (job.node && job.node !== guest.node ? 'other_node' : 'selected')
  const vmid = String(guest.vmid)

  if (job.pool) return guest.pool === job.pool ? onNode() : 'not_selected'
  if (job.vmid) return splitList(job.vmid).includes(vmid) ? onNode() : 'not_selected'
  if (truthy(job.all)) return splitList(job.exclude).includes(vmid) ? 'excluded' : onNode()
  return 'not_selected'
}

/** Covered, or why not, against the jobs of the guest's own cluster. */
export function evaluateGuest(
  guest: CoverageGuest,
  jobs: VzdumpJob[],
): { covered: true; jobIds: string[] } | { covered: false; reason: UncoveredReason; jobIds: string[] } {
  const covering: string[] = []
  const excluded: string[] = []
  const otherNode: string[] = []
  const disabled: string[] = []
  let enabledCount = 0

  for (const job of jobs) {
    const sel = jobSelection(job, guest)
    const id = job.id || ''
    if (!isJobEnabled(job)) {
      if (sel === 'selected') disabled.push(id)
      continue
    }
    enabledCount++
    if (sel === 'selected') covering.push(id)
    else if (sel === 'excluded') excluded.push(id)
    else if (sel === 'other_node') otherNode.push(id)
  }

  if (covering.length > 0) return { covered: true, jobIds: covering }
  // The most actionable reason first: an explicit exclusion beats a node
  // restriction, which beats a job that would cover the guest if enabled.
  if (excluded.length > 0) return { covered: false, reason: 'excluded', jobIds: excluded }
  if (otherNode.length > 0) return { covered: false, reason: 'other_node', jobIds: otherNode }
  if (disabled.length > 0) return { covered: false, reason: 'disabled_job', jobIds: disabled }
  return { covered: false, reason: enabledCount === 0 ? 'no_job' : 'not_selected', jobIds: [] }
}

export function guestKey(guest: { connId: string; vmid: string | number }): string {
  return `${guest.connId}:${guest.vmid}`
}

export type ResolveCoverageInput = {
  guests: CoverageGuest[]
  jobsByConnection: Record<string, VzdumpJob[]>
  settings: CoverageSettings
  /** Milliseconds since the epoch. */
  now: number
  /** Unix seconds keyed by guestKey(); a guest missing here is never treated as recent. */
  createdAt?: Map<string, number>
}

export function resolveBackupCoverage(input: ResolveCoverageInput): CoverageResult {
  const { guests, jobsByConnection, settings, now, createdAt } = input
  const tag = settings.excludeTag.trim().toLowerCase()
  const graceMs = Math.max(0, settings.graceHours) * 3_600_000
  const summary: CoverageSummary = { total: 0, covered: 0, uncovered: 0, ignored: { template: 0, tag: 0, grace: 0 } }
  const uncovered: UncoveredGuest[] = []

  for (const guest of guests) {
    if (guest.template) {
      summary.ignored.template++
      continue
    }
    summary.total++

    const verdict = evaluateGuest(guest, jobsByConnection[guest.connId] || [])
    if (verdict.covered === true) {
      summary.covered++
      continue
    }

    if (tag && (guest.tags || []).some(t => t.toLowerCase() === tag)) {
      summary.ignored.tag++
      continue
    }

    const created = createdAt?.get(guestKey(guest)) ?? null
    if (graceMs > 0 && created !== null && now - created * 1000 < graceMs) {
      summary.ignored.grace++
      continue
    }

    summary.uncovered++
    uncovered.push({ ...guest, reason: verdict.reason, jobIds: verdict.jobIds, createdAt: created })
  }

  return { uncovered, summary }
}

/**
 * Creation time of a QEMU guest: PVE stamps `meta: creation-qemu=X,ctime=<unix>`
 * into the config when it creates the VM (PVE 7.0 and later). LXC configs carry
 * no such stamp.
 */
export function parseMetaCtime(config: unknown): number | null {
  const meta = config && typeof config === 'object' ? (config as Record<string, unknown>).meta : undefined
  if (typeof meta !== 'string') return null
  const m = /(?:^|,)\s*ctime=(\d+)/.exec(meta)
  if (!m) return null
  const n = Number.parseInt(m[1], 10)
  return n > 0 ? n : null
}

/** Task types whose task id is the vmid of the guest they bring into existence. */
const CREATION_TASK_TYPES = new Set(['qmcreate', 'vzcreate', 'qmrestore', 'vzrestore'])

/**
 * Fallback creation times from /cluster/tasks: the latest create or restore
 * task per vmid. Clones are invisible here (their task id is the SOURCE vmid)
 * and the list only holds the recent tasks, which is all a grace period needs.
 */
export function creationTimesFromTasks(tasks: unknown): Map<string, number> {
  const out = new Map<string, number>()
  if (!Array.isArray(tasks)) return out
  for (const task of tasks) {
    if (!task || typeof task !== 'object') continue
    const { type, id, starttime } = task as Record<string, unknown>
    if (typeof type !== 'string' || !CREATION_TASK_TYPES.has(type)) continue
    const vmid = id === undefined || id === null ? '' : String(id)
    const start = Number(starttime)
    if (!vmid || !Number.isFinite(start) || start <= 0) continue
    if (start > (out.get(vmid) ?? 0)) out.set(vmid, start)
  }
  return out
}

export type AddGuestRefusal = 'pool' | 'other_node' | 'already' | 'no_selection'

export type AddGuestPlan =
  | {
      ok: true
      /** Only the PVE fields that change; every other field of the job stays untouched. */
      set: Record<string, string>
      /** PVE `delete` list, for a field the change empties (an exclude list down to nothing). */
      remove: string[]
      /** The job is disabled: the guest stays uncovered until it is enabled. */
      disabled: boolean
    }
  | { ok: false; reason: AddGuestRefusal }

/**
 * What "add this guest to that job" means for a vzdump job, with the same
 * precedence PVE applies: a pool job is never edited (the guest joins through
 * the pool), a job pinned to another node would still skip it, an `all` job
 * drops the vmid from its exclusions, a `vmid` job gets it appended.
 */
export function planAddGuestToJob(job: VzdumpJob, guest: { vmid: string | number; node: string }): AddGuestPlan {
  const vmid = String(guest.vmid)
  const disabled = !isJobEnabled(job)

  if (job.pool) return { ok: false, reason: 'pool' }
  if (job.node && job.node !== guest.node) return { ok: false, reason: 'other_node' }

  if (job.vmid) {
    const list = splitList(job.vmid)
    if (list.includes(vmid)) return { ok: false, reason: 'already' }
    return { ok: true, set: { vmid: [...list, vmid].join(',') }, remove: [], disabled }
  }

  if (truthy(job.all)) {
    const exclude = splitList(job.exclude)
    if (!exclude.includes(vmid)) return { ok: false, reason: 'already' }
    const rest = exclude.filter(v => v !== vmid)
    return rest.length
      ? { ok: true, set: { exclude: rest.join(',') }, remove: [], disabled }
      : { ok: true, set: {}, remove: ['exclude'], disabled }
  }

  return { ok: false, reason: 'no_selection' }
}
