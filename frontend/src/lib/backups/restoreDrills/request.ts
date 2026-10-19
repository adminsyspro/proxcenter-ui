// src/lib/backups/restoreDrills/request.ts
//
// Validation of the body the Backups page sends for a restore drill, and its
// translation into the orchestrator's DrillRequest. The PVE-side archive
// volid is resolved here, the same way the whole-guest restore route does it:
// a `pbs` storage of the target cluster pointing at this PBS server,
// datastore and namespace, then `<storage>:backup/<type>/<id>/<time>`.

import { matchingPbsStorages, pbsHostOf } from '@/lib/guestFileRestore/pbsPveStorages'

import { SETTINGS_RANGES, type DrillNetworkMode, type DrillRequest, type DrillSettings, type DrillVerifyState } from './types'

export const CT_NOT_SUPPORTED = 'guest type ct is not supported by restore drills yet'
export const NO_MATCHING_STORAGE = 'No PVE storage of this cluster points to this PBS datastore and namespace'

/** PVE identifiers (node, storage, bridge): what PVE itself accepts. */
export const PVE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const BACKUP_TIME_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d{1,9})?Z$/
export const NETWORK_MODES: readonly DrillNetworkMode[] = ['link_down', 'bridge']
const VERIFY_STATES: readonly DrillVerifyState[] = ['ok', 'failed', 'none']

const TIMEOUT_FIELDS = [
  ['restoreTimeoutSec', 'restore_timeout_sec'],
  ['bootTimeoutSec', 'boot_timeout_sec'],
  ['agentTimeoutSec', 'agent_timeout_sec'],
] as const

export interface DrillInput {
  pbsId: string
  datastore: string
  namespace: string
  backupType: string
  backupId: string
  /** RFC 3339 UTC, seconds precision. */
  backupTime: string
  vmName: string
  verifyState: DrillVerifyState
  verifiedAt: string
  backupSize: number
  targetConnectionId: string
  targetNode: string
  targetStorage: string
  networkMode: DrillNetworkMode
  bridge: string
  restoreTimeoutSec: number
  bootTimeoutSec: number
  agentTimeoutSec: number
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/** RFC 3339 UTC without fractions, the form PBS snapshot names and the contract use. */
export function toRfc3339Seconds(value: string | number | Date): string {
  return new Date(value).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/** Strips fractional seconds the way PVE's PBS volume name regex requires. */
export function normalizeBackupTime(value: string): string | null {
  const m = BACKUP_TIME_RE.exec(value)
  return m ? `${m[1]}Z` : null
}

function timeoutField(raw: unknown, field: (typeof TIMEOUT_FIELDS)[number][1]): ParseResult<number> {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: 0 }
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isInteger(n)) return { ok: false, error: `${field} must be an integer` }
  const [min, max] = SETTINGS_RANGES[field]
  // 0 lets the orchestrator apply its settings default.
  if (n !== 0 && (n < min || n > max)) return { ok: false, error: `${field} must be 0 or between ${min} and ${max}` }
  return { ok: true, value: n }
}

/** Validates the UI body. Only the shape: authorisation and resolution come after. */
export function parseDrillInput(body: unknown): ParseResult<DrillInput> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Invalid body' }
  const b = body as Record<string, unknown>

  const required = {
    pbsId: str(b.pbsId),
    datastore: str(b.datastore),
    backupType: str(b.backupType),
    backupId: typeof b.backupId === 'number' ? String(b.backupId) : str(b.backupId),
    targetConnectionId: str(b.targetConnectionId),
    targetNode: str(b.targetNode),
    targetStorage: str(b.targetStorage),
  }
  for (const [k, v] of Object.entries(required)) {
    if (!v) return { ok: false, error: `${k} is required` }
  }
  if (!/^\d+$/.test(required.backupId)) return { ok: false, error: 'backupId must be numeric' }
  if (!PVE_NAME_RE.test(required.targetNode)) return { ok: false, error: 'targetNode is invalid' }
  if (!PVE_NAME_RE.test(required.targetStorage)) return { ok: false, error: 'targetStorage is invalid' }

  const backupTime = normalizeBackupTime(str(b.backupTime))
  if (!backupTime) return { ok: false, error: 'backupTime must be an RFC 3339 UTC timestamp' }

  const networkMode = str(b.networkMode) || 'link_down'
  if (!NETWORK_MODES.includes(networkMode as DrillNetworkMode)) return { ok: false, error: 'networkMode must be link_down or bridge' }
  const bridge = networkMode === 'bridge' ? str(b.bridge) : ''
  if (networkMode === 'bridge' && !PVE_NAME_RE.test(bridge)) return { ok: false, error: 'bridge is required when networkMode is bridge' }

  const verifyState = str(b.verifyState) || 'none'
  if (!VERIFY_STATES.includes(verifyState as DrillVerifyState)) return { ok: false, error: 'verifyState must be ok, failed or none' }

  let verifiedAt = ''
  const rawVerifiedAt = str(b.verifiedAt)
  if (rawVerifiedAt) {
    if (Number.isNaN(Date.parse(rawVerifiedAt))) return { ok: false, error: 'verifiedAt must be an RFC 3339 timestamp' }
    verifiedAt = toRfc3339Seconds(rawVerifiedAt)
  }

  const size = b.backupSize === undefined || b.backupSize === null ? 0 : Number(b.backupSize)
  if (!Number.isFinite(size) || size < 0) return { ok: false, error: 'backupSize must be a positive number' }

  const timeouts: Record<string, number> = {}
  for (const [inKey, field] of TIMEOUT_FIELDS) {
    const r = timeoutField(b[inKey], field)
    if (r.ok === false) return { ok: false, error: r.error }
    timeouts[inKey] = r.value
  }

  return {
    ok: true,
    value: {
      ...required,
      namespace: typeof b.namespace === 'string' ? b.namespace.trim().replace(/^\/+|\/+$/g, '') : '',
      backupTime,
      vmName: str(b.vmName),
      verifyState: verifyState as DrillVerifyState,
      verifiedAt,
      backupSize: Math.floor(size),
      networkMode: networkMode as DrillNetworkMode,
      bridge,
      restoreTimeoutSec: timeouts.restoreTimeoutSec,
      bootTimeoutSec: timeouts.bootTimeoutSec,
      agentTimeoutSec: timeouts.agentTimeoutSec,
    },
  }
}

/** `<storage>:backup/<type>/<id>/<time>`, exactly as the restore route builds it. */
export function buildArchiveVolid(storage: string, input: Pick<DrillInput, 'backupType' | 'backupId' | 'backupTime'>): string {
  const archive = `${storage}:backup/${input.backupType}/${input.backupId}/${input.backupTime}`
  return archive.replace(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.\d{1,6}Z$/, '$1Z')
}

/**
 * The `pbs` storage of the target cluster that reaches this restore point
 * from the target node: same server, datastore and namespace, and either not
 * restricted to some nodes or restricted to a list that holds the node.
 */
export function pickPbsStorage(
  storages: unknown,
  match: { baseUrl: string; datastore: string; namespace: string; node: string },
): string | null {
  const candidates = matchingPbsStorages(storages, {
    host: pbsHostOf(match.baseUrl),
    datastore: match.datastore,
    namespace: match.namespace,
  })
  const usable = candidates.find(s => s.nodes.length === 0 || s.nodes.includes(match.node))
  return usable?.storage ?? null
}

export function toDrillRequest(
  input: DrillInput,
  resolved: { pbsName: string; pbsStorage: string; requestedBy: string },
): DrillRequest {
  return {
    connection_id: input.targetConnectionId,
    node: input.targetNode,
    target_storage: input.targetStorage,
    archive: buildArchiveVolid(resolved.pbsStorage, input),
    network_mode: input.networkMode,
    bridge: input.bridge,
    restore_timeout_sec: input.restoreTimeoutSec,
    boot_timeout_sec: input.bootTimeoutSec,
    agent_timeout_sec: input.agentTimeoutSec,
    source: {
      pbs_id: input.pbsId,
      pbs_name: resolved.pbsName,
      pbs_storage: resolved.pbsStorage,
      datastore: input.datastore,
      namespace: input.namespace,
      backup_type: input.backupType,
      backup_id: input.backupId,
      backup_time: input.backupTime,
      vm_name: input.vmName,
      verify_state: input.verifyState,
      verified_at: input.verifiedAt,
      backup_size_bytes: input.backupSize,
    },
    requested_by: resolved.requestedBy,
  }
}

/** The orchestrator's default, kept when a client predating the field leaves it out. */
export const DEFAULT_SCREENSHOT_DELAY_SEC = 45

/** Range check of the settings row, the same bounds as the orchestrator. */
export function parseDrillSettings(body: unknown): ParseResult<DrillSettings> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Invalid body' }
  const b = body as Record<string, unknown>
  const numbers: Record<string, number> = {}
  for (const [field, [min, max]] of Object.entries(SETTINGS_RANGES)) {
    let raw = b[field]
    if (field === 'screenshot_delay_sec' && (raw === undefined || raw === null || raw === '')) raw = DEFAULT_SCREENSHOT_DELAY_SEC
    const n = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isInteger(n) || n < min || n > max) return { ok: false, error: `${field} must be an integer between ${min} and ${max}` }
    numbers[field] = n
  }
  const mode = str(b.default_network_mode) || 'link_down'
  if (!NETWORK_MODES.includes(mode as DrillNetworkMode)) return { ok: false, error: 'default_network_mode must be link_down or bridge' }
  const bridge = str(b.default_bridge)
  if (bridge && !PVE_NAME_RE.test(bridge)) return { ok: false, error: 'default_bridge is invalid' }
  return {
    ok: true,
    value: {
      max_concurrent: numbers.max_concurrent,
      capacity_budget_gb: numbers.capacity_budget_gb,
      free_space_margin_pct: numbers.free_space_margin_pct,
      restore_timeout_sec: numbers.restore_timeout_sec,
      boot_timeout_sec: numbers.boot_timeout_sec,
      agent_timeout_sec: numbers.agent_timeout_sec,
      default_network_mode: mode as DrillNetworkMode,
      default_bridge: bridge,
      screenshot_delay_sec: numbers.screenshot_delay_sec,
    },
  }
}

/** Drill ids are orchestrator UUIDs: anything else never reaches its URL. */
export function isDrillId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(id)
}

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

/** Page size of a list route: 20 by default, 1..100. */
export function parseLimit(raw: string | null): number {
  const n = raw === null ? DEFAULT_LIMIT : Number(raw)
  if (!Number.isInteger(n)) return DEFAULT_LIMIT
  return Math.min(Math.max(n, 1), MAX_LIMIT)
}

export function parseOffset(raw: string | null): number {
  const n = Number(raw ?? 0)
  return Number.isInteger(n) && n > 0 ? n : 0
}
