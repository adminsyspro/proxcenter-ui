import { pveFetch, PveApplicationError, type ProxmoxClientOptions } from '@/lib/proxmox/client'
import { isSharedStorage } from '@/lib/proxmox/storage'

import {
  formatBwlimit,
  isClusterStorageType,
  SECRET_KEYS,
  STORAGE_ID_RE,
  STORAGE_TYPE_SPECS,
  type BwlimitMiB,
  type ClusterStorageType,
} from './clusterStorageTypes'

/**
 * Adding, editing and removing a cluster storage (roadmap#202): the request a
 * dialog sends turned into Proxmox's `storage.cfg` parameters, the scan that
 * tests a target before it is saved, and the usage check before a removal.
 */

export class ClusterStorageError extends Error {
  readonly status: number
  readonly code: string

  constructor(message: string, status = 400, code = 'invalid_request') {
    super(message)
    this.name = 'ClusterStorageError'
    this.status = status
    this.code = code
  }
}

export type ClusterStorageInput = {
  type: ClusterStorageType
  storage?: string
  /** Type fields, by Proxmox key (server, export, keyring...). */
  fields?: Record<string, unknown>
  content?: string[]
  nodes?: string[]
  enabled?: boolean
  shared?: boolean
  bwlimit?: BwlimitMiB | null
}

const NODE_RE = /^[A-Za-z0-9][A-Za-z0-9.-]*$/
const VOLID_RE = /^[A-Za-z][A-Za-z0-9\-_.]*:[^\s,]+$/
// A keyring spans lines; every other value is one line.
const MULTILINE_KEYS = new Set(['keyring'])

function fieldValue(key: string, raw: unknown): string {
  if (raw === undefined || raw === null) return ''
  const value = String(raw).trim()
  const max = MULTILINE_KEYS.has(key) ? 8192 : 1024
  if (value.length > max) throw new ClusterStorageError(`${key} is too long`)
  // eslint-disable-next-line no-control-regex
  const forbidden = MULTILINE_KEYS.has(key) ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/ : /[\u0000-\u001f]/
  if (forbidden.test(value)) throw new ClusterStorageError(`${key} holds a control character`)
  return value
}

/** Body of the PVE call, and the keys a PUT clears. */
export type StorageParams = { params: Record<string, string>; deletes: string[] }

/**
 * The Proxmox parameters of a create (every field) or an update (only what
 * Proxmox lets change). On update an empty secret keeps the stored one and an
 * emptied optional field is cleared.
 */
export function buildStorageParams(input: ClusterStorageInput, mode: 'create' | 'update'): StorageParams {
  if (!isClusterStorageType(input?.type)) throw new ClusterStorageError('Unsupported storage type')
  const spec = STORAGE_TYPE_SPECS[input.type]
  const params: Record<string, string> = {}
  const deletes: string[] = []
  const fields = input.fields ?? {}

  if (mode === 'create') {
    const id = String(input.storage ?? '').trim()
    if (!STORAGE_ID_RE.test(id)) throw new ClusterStorageError('Invalid storage id')
    params.storage = id
    params.type = input.type
  }

  for (const field of spec.fields) {
    if (mode === 'update' && field.fixed) continue
    if (field.shownWhen && String(fields[field.shownWhen.key] ?? '') !== field.shownWhen.value) continue
    const required = mode === 'create' && (field.required || (field.requiredWhen && String(fields[field.requiredWhen.key] ?? '') === field.requiredWhen.value))

    if (field.kind === 'boolean') {
      if (fields[field.key] !== undefined) params[field.key] = fields[field.key] === true || fields[field.key] === '1' ? '1' : '0'
      continue
    }

    const value = fieldValue(field.key, fields[field.key])

    if (field.kind === 'select' && value && !field.options?.includes(value)) throw new ClusterStorageError(`Invalid ${field.key}`)
    if (!value || (field.key === 'smbversion' && value === 'default')) {
      if (required) throw new ClusterStorageError(`${field.key} is required`)
      // A secret left blank keeps the stored one; anything else blank is cleared.
      if (mode === 'update' && field.kind !== 'secret' && !field.required) deletes.push(field.key)
      continue
    }
    if (field.key === 'base' && !VOLID_RE.test(value)) throw new ClusterStorageError('Invalid base volume')
    params[field.key] = value
  }

  const content = [...new Set((input.content ?? []).map(String))]
  if (!content.length) throw new ClusterStorageError('Pick at least one content type')
  if (content.some(c => !spec.contents.includes(c))) throw new ClusterStorageError('Content type not allowed for this storage')
  if (content.includes('none') && content.length > 1) throw new ClusterStorageError('Content type not allowed for this storage')
  params.content = content.join(',')

  const nodes = [...new Set((input.nodes ?? []).map(String))]
  if (nodes.some(n => !NODE_RE.test(n))) throw new ClusterStorageError('Invalid node name')
  if (nodes.length) params.nodes = nodes.join(',')
  else if (mode === 'update') deletes.push('nodes')

  if (input.enabled === false) params.disable = '1'
  else if (mode === 'update') deletes.push('disable')

  if (spec.sharedChoice && input.shared !== undefined) params.shared = input.shared ? '1' : '0'

  const bwlimit = formatBwlimit(input.bwlimit)
  if (bwlimit) params.bwlimit = bwlimit
  else if (mode === 'update') deletes.push('bwlimit')

  return { params, deletes }
}

/** A storage config as the edit dialog may read it: no secret, ever. */
export function scrubStorageConfig(cfg: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(cfg ?? {})) {
    if (!(SECRET_KEYS as readonly string[]).includes(k)) out[k] = v
  }
  return out
}

/** Every occurrence of the secrets of a request, out of a message. */
export function redactSecrets(message: string, secrets: Array<string | undefined | null>): string {
  return secrets.filter((s): s is string => !!s && s.length >= 3).reduce((m, s) => m.split(s).join('***'), message)
}

// ── Scan ────────────────────────────────────────────────────────────────────

export type ScanRequest = { type: 'nfs' | 'cifs' | 'iscsi' | 'lvm'; server?: string; username?: string; password?: string; domain?: string; portal?: string }
export type ScanEntry = { value: string; detail: string | null }

/** Past this, ProxCenter stops waiting: the node's answer is a test, not a job. */
export const SCAN_TIMEOUT_MS = 20_000
/**
 * How long a scan that ProxCenter stopped waiting for still holds its node:
 * pvedaemon keeps running it (a `showmount` towards an unreachable NFS server
 * was measured at 196 s on PVE 9.2), whether or not anyone still waits.
 */
export const SCAN_HOLD_MS = 240_000

const SCAN_LOCKS_KEY = '__proxcenter_storage_scan_locks__' as const

function scanLocks(): Map<string, number> {
  const g = globalThis as any
  if (!g[SCAN_LOCKS_KEY]) g[SCAN_LOCKS_KEY] = new Map<string, number>()
  return g[SCAN_LOCKS_KEY]
}

/** Test seam: forget every scan lock. */
export function resetScanLocks(): void {
  scanLocks().clear()
}

function scanQuery(req: ScanRequest): URLSearchParams {
  const q = new URLSearchParams()
  const need = (key: keyof ScanRequest) => {
    const value = fieldValue(key, req[key])
    if (!value) throw new ClusterStorageError(`${key} is required`)
    q.set(key, value)
  }
  const maybe = (key: keyof ScanRequest) => {
    const value = fieldValue(key, req[key])
    if (value) q.set(key, value)
  }
  if (req.type === 'nfs') need('server')
  if (req.type === 'cifs') {
    need('server')
    maybe('username')
    maybe('password')
    maybe('domain')
  }
  if (req.type === 'iscsi') need('portal')
  return q
}

function scanEntries(type: ScanRequest['type'], rows: any[]): ScanEntry[] {
  const list = Array.isArray(rows) ? rows : []
  switch (type) {
    case 'nfs':
      return list.map(r => ({ value: String(r.path), detail: r.options ? String(r.options) : null }))
    case 'cifs':
      return list.map(r => ({ value: String(r.share), detail: r.description ? String(r.description) : null }))
    case 'iscsi':
      return list.map(r => ({ value: String(r.target), detail: r.portal ? String(r.portal) : null }))
    default:
      return list.map(r => ({ value: String(r.vg), detail: r.free !== undefined ? String(r.free) : null }))
  }
}

/**
 * One Proxmox scan from one node, at most one at a time per node across every
 * user: a scan occupies one of the node's three pvedaemon workers until it
 * ends, and a second one waiting behind a dead NFS server would take another.
 * The node's slot is held until Proxmox actually answered, or for
 * SCAN_HOLD_MS once ProxCenter stopped waiting. Never replayed elsewhere.
 */
export async function scanStorageTarget(conn: ProxmoxClientOptions, connId: string, node: string, req: ScanRequest): Promise<ScanEntry[]> {
  if (!['nfs', 'cifs', 'iscsi', 'lvm'].includes(req?.type)) throw new ClusterStorageError('Unsupported scan')
  if (!NODE_RE.test(String(node ?? ''))) throw new ClusterStorageError('Invalid node name')
  const query = scanQuery(req)
  const key = `${connId}:${node}`
  const locks = scanLocks()
  const now = Date.now()

  if ((locks.get(key) ?? 0) > now) {
    throw new ClusterStorageError('A connection test is already running on this node. Try again in a few minutes.', 409, 'SCAN_BUSY')
  }
  locks.set(key, now + SCAN_HOLD_MS)

  let answered = false
  try {
    const qs = query.toString()
    const rows = await pveFetch<any[]>(
      conn,
      `/nodes/${encodeURIComponent(node)}/scan/${req.type}${qs ? `?${qs}` : ''}`,
      {},
      // Above the default budget: a slow answer is not a dead node, so the
      // client never replays the scan through another node.
      { timeoutMs: SCAN_TIMEOUT_MS },
    )
    answered = true
    return scanEntries(req.type, rows)
  } catch (e: any) {
    if (e instanceof PveApplicationError) {
      answered = true
      throw new ClusterStorageError(redactSecrets(pveMessage(e), [req.password]), 422, 'SCAN_FAILED')
    }
    throw new ClusterStorageError('The node did not answer the connection test in time. It may still be running it: try again in a few minutes.', 504, 'SCAN_TIMEOUT')
  } finally {
    if (answered) locks.delete(key)
  }
}

/** Proxmox's own sentence out of `PVE <status> <path>: <json body>`. */
export function pveMessage(e: any): string {
  const raw = e?.message || String(e)
  const body = /^PVE \d+ [^:]*: ([\s\S]*)$/.exec(raw)?.[1]
  if (!body) return raw
  try {
    const parsed = JSON.parse(body)
    const detail = parsed?.errors ? Object.entries(parsed.errors).map(([k, v]) => `${k}: ${v}`).join(' ') : ''
    return [parsed?.message, detail].filter(Boolean).join(' ').trim() || raw
  } catch {
    return raw
  }
}

// ── Usage before removal ────────────────────────────────────────────────────

export type StorageUsage = {
  /** Guest volumes (disks, container volumes) found on the storage. */
  volumes: Array<{ volid: string; vmid: number }>
  /** Backup jobs that write to it. */
  backupJobs: string[]
  /** Other storages built on it (an LVM whose base volume is one of its LUNs). */
  dependents: string[]
  /** Nodes whose listing could not be read (storage offline, node down). */
  unverified: string[]
}

const USAGE_CONCURRENCY = 2

/**
 * What still uses a storage: guest volumes on it, and backup jobs targeting
 * it. A shared storage is listed from one node (the first that answers), a
 * local one from each of its nodes, two at a time.
 */
export async function storageUsage(
  conn: ProxmoxClientOptions,
  storage: string,
  cfg: Record<string, any>,
  clusterNodes: string[],
): Promise<StorageUsage> {
  const nodes = cfg?.nodes ? String(cfg.nodes).split(',').map(s => s.trim()).filter(Boolean) : clusterNodes
  const shared = isSharedStorage({ shared: cfg?.shared, type: cfg?.type })
  const volumes = new Map<string, number>()
  const unverified: string[] = []

  const list = async (node: string): Promise<boolean> => {
    try {
      const rows = await pveFetch<any[]>(conn, `/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/content`, {}, { timeoutMs: SCAN_TIMEOUT_MS })
      for (const r of rows || []) {
        const vmid = Number(r?.vmid)
        if (vmid > 0 && (r?.content === 'images' || r?.content === 'rootdir')) volumes.set(String(r.volid), vmid)
      }
      return true
    } catch {
      unverified.push(node)
      return false
    }
  }

  // Shared: the first node that answers speaks for all of them.
  const firstAnswer = async (rest: string[]): Promise<void> => {
    if (!rest.length) return
    if (!(await list(rest[0]))) return firstAnswer(rest.slice(1))
    unverified.length = 0
  }
  // Local: every node, USAGE_CONCURRENCY at a time.
  const inBatches = async (rest: string[]): Promise<void> => {
    if (!rest.length) return
    await Promise.all(rest.slice(0, USAGE_CONCURRENCY).map(list))
    return inBatches(rest.slice(USAGE_CONCURRENCY))
  }

  await (shared ? firstAnswer(nodes) : inBatches(nodes))

  const jobs: any[] | null = await pveFetch<any[]>(conn, '/cluster/backup').catch(() => null)
  if (jobs === null) unverified.push('backup jobs')
  const backupJobs = (jobs || []).filter((j: any) => j?.storage === storage).map((j: any) => String(j.id))

  const storages: any[] | null = await pveFetch<any[]>(conn, '/storage').catch(() => null)
  if (storages === null) unverified.push('storage.cfg')
  const dependents = (storages || [])
    .filter((s: any) => s?.storage !== storage && String(s?.base ?? '').startsWith(`${storage}:`))
    .map((s: any) => String(s.storage))

  return {
    volumes: [...volumes].map(([volid, vmid]) => ({ volid, vmid })).sort((a, b) => a.vmid - b.vmid || a.volid.localeCompare(b.volid)),
    backupJobs,
    dependents,
    unverified,
  }
}
