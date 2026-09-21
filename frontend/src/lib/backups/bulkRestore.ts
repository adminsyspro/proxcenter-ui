// Pure helpers behind the bulk restore wizard (issue #983).
//
// Everything here is client-safe on purpose: the wizard is a client
// component, so this module must never import prisma, pveFetch or anything
// else that drags a server value into a `'use client'` bundle. That is also
// why the range allocator below is not `findNextFreeVmid` from
// `@/lib/tenant/vmidRange`, because that module imports prisma at top level.
//
// The unit of work is a GUEST, not a snapshot: the PBS listing is flat (one
// row per snapshot), the wizard restores "one backup per VM", so the first
// thing we do is fold the flat list back into guests carrying their restore
// points, newest first.

/** One restore point of one guest, as the PBS listing exposes it. */
export interface BulkRestorePoint {
  id: string
  backupTime: number
  backupTimeFormatted: string
  backupTimeIso: string
  size: number
  sizeFormatted: string
  verified: boolean
  protected: boolean
}

export interface GuestBackupGroup {
  /** Stable identity of the guest WITHIN this PBS server. Two datastores or
   *  two namespaces can legitimately hold backups of the same VMID (a copy
   *  job, or two vDCs), and they are different restore sources. */
  key: string
  datastore: string
  namespace: string
  backupType: 'vm' | 'ct'
  vmid: number
  vmName: string
  points: BulkRestorePoint[]
}

/** Raw row shape of GET /api/v1/pbs/{id}/backups (see CachedBackup). */
export interface RawBackupRow {
  id?: string
  datastore?: string
  namespace?: string
  backupType?: string
  backupId?: string | number
  vmName?: string
  backupTime?: number
  backupTimeFormatted?: string
  backupTimeIso?: string
  size?: number
  sizeFormatted?: string
  verified?: boolean
  protected?: boolean
}

export function guestKey(datastore: string, namespace: string, backupType: string, vmid: number): string {
  return `${datastore}|${namespace}|${backupType}|${vmid}`
}

/**
 * Fold the flat snapshot list into one entry per guest.
 *
 * `host` backups are dropped: they are file-level host backups, there is no
 * qmrestore/vzrestore for them (the per-backup drawer already disables its
 * Restore button for that type). Rows whose backupId is not a positive
 * integer are dropped too, since a VMID is what every downstream PVE call needs.
 */
export function groupBackupsByGuest(rows: RawBackupRow[]): GuestBackupGroup[] {
  const groups = new Map<string, GuestBackupGroup>()

  for (const row of rows || []) {
    const backupType = row?.backupType === 'ct' ? 'ct' : row?.backupType === 'vm' ? 'vm' : null
    if (!backupType) continue

    const vmid = Number(row?.backupId)
    if (!Number.isInteger(vmid) || vmid <= 0) continue

    const datastore = row?.datastore || ''
    const namespace = row?.namespace || ''
    const key = guestKey(datastore, namespace, backupType, vmid)

    let group = groups.get(key)
    if (!group) {
      group = { key, datastore, namespace, backupType, vmid, vmName: '', points: [] }
      groups.set(key, group)
    }

    group.points.push({
      id: row?.id || `${key}|${row?.backupTimeIso || ''}`,
      backupTime: Number(row?.backupTime) || 0,
      backupTimeFormatted: row?.backupTimeFormatted || '',
      backupTimeIso: row?.backupTimeIso || '',
      size: Number(row?.size) || 0,
      sizeFormatted: row?.sizeFormatted || '',
      verified: !!row?.verified,
      protected: !!row?.protected,
    })
  }

  // Newest first: the wizard defaults every guest to points[0].
  for (const group of groups.values()) {
    group.points.sort((a, b) => b.backupTime - a.backupTime)
  }

  // The friendly name lives per SNAPSHOT (PBS `comment`), so resolve it from
  // the most recent row that carries one: a renamed VM then shows its current
  // name rather than the one it had a year ago.
  const newestNameByKey = new Map<string, { time: number; name: string }>()
  for (const row of rows || []) {
    const backupType = row?.backupType === 'ct' ? 'ct' : row?.backupType === 'vm' ? 'vm' : null
    if (!backupType) continue
    const vmid = Number(row?.backupId)
    if (!Number.isInteger(vmid) || vmid <= 0) continue
    const name = (row?.vmName || '').trim()
    if (!name) continue
    const key = guestKey(row?.datastore || '', row?.namespace || '', backupType, vmid)
    const time = Number(row?.backupTime) || 0
    const current = newestNameByKey.get(key)
    if (!current || time > current.time) newestNameByKey.set(key, { time, name })
  }
  for (const [key, entry] of newestNameByKey) {
    const group = groups.get(key)
    if (group) group.vmName = entry.name
  }

  return [...groups.values()].sort(
    (a, b) => a.vmid - b.vmid || a.datastore.localeCompare(b.datastore) || a.namespace.localeCompare(b.namespace),
  )
}

/** Source-side VMID filter: the "range from/to" the issue asks for. */
export function filterGuestsByVmidRange(
  guests: GuestBackupGroup[],
  from: number | null,
  to: number | null,
): GuestBackupGroup[] {
  return guests.filter((g) => (from === null || g.vmid >= from) && (to === null || g.vmid <= to))
}

/** PVE volid path a restore point maps to, same shape the drawer builds. */
export function restorePathFor(group: GuestBackupGroup, point: BulkRestorePoint): string {
  return `backup/${group.backupType}/${group.vmid}/${point.backupTimeIso}`
}

export const VMID_MIN = 100
export const VMID_MAX = 999_999_999

export type TargetMode = 'range' | 'source'

export type PlanIssueCode = 'targetExists' | 'rangeExhausted' | 'rangeInvalid'

export interface PlanEntry {
  key: string
  guest: GuestBackupGroup
  point: BulkRestorePoint | null
  targetVmid: number | null
  issue: PlanIssueCode | null
  /** True when the entry cannot be dispatched as configured. */
  blocking: boolean
}

export interface PlanInput {
  guests: GuestBackupGroup[]
  /** Chosen restore point per guest key; falls back to the newest point. */
  pointByKey?: Record<string, string | undefined>
  mode: TargetMode
  rangeStart?: number | null
  rangeEnd?: number | null
  /** VMIDs already taken on the TARGET cluster. */
  usedVmIds: Set<number>
  /** Only meaningful in `source` mode: restore on top of the existing guest. */
  overwrite?: boolean
}

export interface RestorePlan {
  entries: PlanEntry[]
  /** Distinct issues present in the plan, for a single summary Alert. */
  issues: PlanIssueCode[]
  blockingCount: number
}

function pickPoint(guest: GuestBackupGroup, pointId?: string): BulkRestorePoint | null {
  if (pointId) {
    const found = guest.points.find((p) => p.id === pointId)
    if (found) return found
  }
  return guest.points[0] ?? null
}

/**
 * Assign a target VMID to every selected guest.
 *
 * `range` mode walks [start, end] handing out the lowest free VMIDs, skipping
 * both the ones already live on the target cluster and the ones this very
 * plan has just handed to an earlier guest. Running out of range is not a
 * silent truncation: the remaining entries carry `rangeExhausted` and block.
 *
 * `source` mode restores onto the original VMID. Colliding with a live guest
 * is a blocker unless `overwrite` is on, in which case it is the whole point
 * (the caller then sends force=1) and stays a warning.
 */
export function planTargets(input: PlanInput): RestorePlan {
  const { guests, pointByKey = {}, mode, usedVmIds, overwrite = false } = input
  const entries: PlanEntry[] = []

  const start = input.rangeStart ?? null
  const end = input.rangeEnd ?? null
  const rangeInvalid =
    mode === 'range' &&
    (start === null ||
      end === null ||
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < VMID_MIN ||
      end > VMID_MAX ||
      start > end)

  let cursor = start ?? VMID_MIN
  const allocated = new Set<number>()

  for (const guest of guests) {
    const point = pickPoint(guest, pointByKey[guest.key])
    const base: Omit<PlanEntry, 'targetVmid' | 'issue' | 'blocking'> = { key: guest.key, guest, point }

    if (mode === 'source') {
      const taken = usedVmIds.has(guest.vmid)
      entries.push({
        ...base,
        targetVmid: guest.vmid,
        issue: taken ? 'targetExists' : null,
        blocking: taken && !overwrite,
      })
      continue
    }

    if (rangeInvalid) {
      entries.push({ ...base, targetVmid: null, issue: 'rangeInvalid', blocking: true })
      continue
    }

    while (cursor <= (end as number) && (usedVmIds.has(cursor) || allocated.has(cursor))) cursor++
    if (cursor > (end as number)) {
      entries.push({ ...base, targetVmid: null, issue: 'rangeExhausted', blocking: true })
      continue
    }

    allocated.add(cursor)
    entries.push({ ...base, targetVmid: cursor, issue: null, blocking: false })
    cursor++
  }

  const issues: PlanIssueCode[] = []
  for (const e of entries) {
    if (e.issue && !issues.includes(e.issue)) issues.push(e.issue)
  }

  return { entries, issues, blockingCount: entries.filter((e) => e.blocking).length }
}

/** PVE's `dns-name` format, which is what `name` is validated against. */
const DNS_NAME_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/

/**
 * Compose the restored guest's name and make it acceptable to PVE.
 *
 * `POST /nodes/{node}/qemu` validates `name` as a DNS name, so a guest called
 * "e2e roadmap#6 restore test" makes the whole restore fail with
 * `invalid format - value does not look like a valid DNS name` (measured in
 * the lab on 2026-09-21). A batch must not lose a guest over a cosmetic
 * rename: invalid characters are folded to hyphens, and a name that still
 * cannot be salvaged is dropped so the restore runs without renaming.
 */
export function composeGuestName(vmName: string, suffix: string): string | null {
  const raw = `${vmName || ''}${suffix || ''}`.trim()
  if (!raw) return null

  const labels = raw
    .replace(/[^a-zA-Z0-9.-]+/g, '-')
    .split('.')
    .map(label => label.replace(/^-+/, '').replace(/-+$/, ''))
    .filter(Boolean)
  if (labels.length === 0) return null

  // Keep it inside one DNS label's 63 characters, and never end on a hyphen
  // or a dot once truncated.
  const name = labels.join('.').slice(0, 63).replace(/[-.]+$/, '')

  return DNS_NAME_RE.test(name) ? name : null
}

export interface RestoreOptions {
  storage?: string
  bwlimit?: number | null
  start?: boolean
  unique?: boolean
  /** Applied to the restored guest's name, e.g. "-restore". */
  nameSuffix?: string
  /** Only sent in source+overwrite mode. */
  force?: boolean
}

export interface RestoreRequest {
  vmid: number
  type: 'qemu' | 'lxc'
  pbsBackup: { pbsId: string; datastore: string; namespace: string; backupPath: string }
  storage?: string
  bwlimit?: number
  unique?: boolean
  start?: boolean
  force?: boolean
  name?: string
}

/**
 * Body for POST /api/v1/connections/{id}/nodes/{node}/restore.
 *
 * `name` is deliberately never sent for a container: the route forwards it as
 * PVE's `name` parameter, which only `POST /nodes/{node}/qemu` accepts. The
 * lxc endpoint spells it `hostname` and rejects the unknown key.
 */
export function buildRestoreRequest(
  entry: PlanEntry,
  pbsId: string,
  options: RestoreOptions = {},
): RestoreRequest | null {
  if (entry.targetVmid === null || !entry.point) return null

  const isLxc = entry.guest.backupType === 'ct'
  const body: RestoreRequest = {
    vmid: entry.targetVmid,
    type: isLxc ? 'lxc' : 'qemu',
    pbsBackup: {
      pbsId,
      datastore: entry.guest.datastore,
      namespace: entry.guest.namespace,
      backupPath: restorePathFor(entry.guest, entry.point),
    },
  }

  if (options.storage) body.storage = options.storage
  if (options.bwlimit && options.bwlimit > 0) body.bwlimit = options.bwlimit
  if (options.start) body.start = true
  if (options.force) body.force = true
  // A restore into a FRESH vmid keeps the source MACs unless we ask for new
  // ones, and two live guests sharing a MAC collide on the IPAM's
  // (subnet, mac) unique index as well as on the wire.
  if (options.unique) body.unique = true

  const suffix = (options.nameSuffix || '').trim()
  if (suffix && !isLxc && entry.guest.vmName) {
    const name = composeGuestName(entry.guest.vmName, suffix)
    if (name) body.name = name
  }

  return body
}

export type RestoreJobStatus = 'pending' | 'starting' | 'running' | 'done' | 'failed' | 'cancelled'

export interface RestoreJob {
  key: string
  vmid: number
  targetVmid: number | null
  label: string
  status: RestoreJobStatus
  upid?: string
  error?: string
  progress?: number
  message?: string
  startedAt?: number
  endedAt?: number
}

export function isTerminal(status: RestoreJobStatus): boolean {
  return status === 'done' || status === 'failed' || status === 'cancelled'
}

/**
 * Keys of the jobs to dispatch now, given how many are already in flight.
 * Restore is I/O bound on both the PBS read and the target storage write, so
 * the wizard defaults to a low concurrency; same reasoning as
 * BULK_MIG_CONCURRENCY on the migration side.
 */
export function selectNextJobs(jobs: RestoreJob[], concurrency: number): string[] {
  const active = jobs.filter((j) => j.status === 'starting' || j.status === 'running').length
  const slots = Math.max(0, concurrency - active)
  if (slots === 0) return []
  return jobs.filter((j) => j.status === 'pending').slice(0, slots).map((j) => j.key)
}

export interface JobSummary {
  total: number
  pending: number
  active: number
  done: number
  failed: number
  cancelled: number
  finished: boolean
}

export function summarizeJobs(jobs: RestoreJob[]): JobSummary {
  const count = (s: RestoreJobStatus) => jobs.filter((j) => j.status === s).length
  const pending = count('pending')
  const active = count('starting') + count('running')

  return {
    total: jobs.length,
    pending,
    active,
    done: count('done'),
    failed: count('failed'),
    cancelled: count('cancelled'),
    finished: jobs.length > 0 && pending === 0 && active === 0,
  }
}

/** Map a PVE task status payload onto our job state. */
export function statusFromTask(task: { status?: string; exitstatus?: string | null }): {
  status: RestoreJobStatus
  error?: string
} {
  if (task?.status !== 'stopped') return { status: 'running' }
  const exit = task?.exitstatus || ''
  if (exit === 'OK') return { status: 'done' }
  if (/interrupt|interrupted by user/i.test(exit)) return { status: 'cancelled', error: exit }
  return { status: 'failed', error: exit || 'unknown error' }
}
