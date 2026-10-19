// src/lib/backups/restoreDrills/schedules.ts
//
// Restore drill schedules (roadmap#35, addendum 4). The body the schedule
// modal sends, its server-side validation (the same bounds as the
// orchestrator), its translation into the orchestrator's ScheduleInput once
// the route resolved the PBS storage, and the form helpers of the modal.

import { NETWORK_MODES, PVE_NAME_RE, type ParseResult } from './request'
import {
  SCHEDULE_LIMITS,
  SCHEDULE_RESTORE_POINTS,
  type DrillNetworkMode,
  type Schedule,
  type ScheduleInput,
  type ScheduleRestorePoint,
  type ScheduleScopeMode,
} from './types'

/** What the UI sends: everything but what the route resolves or stamps. */
export interface ScheduleBody {
  name: string
  enabled: boolean
  scope: { mode: ScheduleScopeMode; vmids: number[] }
  restore_point: ScheduleRestorePoint
  source: { pbs_id: string; datastore: string; namespace: string }
  connection_id: string
  node: string
  target_storage: string
  network_mode: DrillNetworkMode
  bridge: string
  calendar: string
  vms_per_run: number
}

const CALENDAR_MAX = 200
const MAX_VMID = 999_999_999

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

export function normalizeNamespace(v: unknown): string {
  return typeof v === 'string' ? v.trim().replace(/^\/+|\/+$/g, '') : ''
}

function parseVmids(raw: unknown): ParseResult<number[]> {
  if (raw === undefined || raw === null) return { ok: true, value: [] }
  if (!Array.isArray(raw)) return { ok: false, error: 'scope.vmids must be an array of VM ids' }
  const out = new Set<number>()
  for (const v of raw) {
    const n = typeof v === 'number' ? v : Number(v)
    if (!Number.isInteger(n) || n < 1 || n > MAX_VMID) return { ok: false, error: 'scope.vmids must hold positive integers' }
    out.add(n)
  }
  return { ok: true, value: [...out].sort((a, b) => a - b) }
}

function parseScope(raw: unknown): ParseResult<ScheduleBody['scope']> {
  const scope = obj(raw)
  const mode = str(scope.mode)
  if (mode !== 'vms' && mode !== 'all') return { ok: false, error: 'scope.mode must be vms or all' }
  if (mode === 'all') return { ok: true, value: { mode, vmids: [] } }
  const vmids = parseVmids(scope.vmids)
  if (vmids.ok === false) return vmids
  if (vmids.value.length === 0 || vmids.value.length > SCHEDULE_LIMITS.vmidsMax) {
    return { ok: false, error: `scope.vmids must hold between 1 and ${SCHEDULE_LIMITS.vmidsMax} VM ids` }
  }
  return { ok: true, value: { mode, vmids: vmids.value } }
}

function parseCalendar(raw: unknown): ParseResult<string> {
  const calendar = str(raw).replace(/\s+/g, ' ')
  if (!calendar) return { ok: false, error: 'calendar is required' }
  if (calendar.length > CALENDAR_MAX) return { ok: false, error: `calendar must be at most ${CALENDAR_MAX} characters` }
  return { ok: true, value: calendar }
}

type TargetFields = Pick<ScheduleBody, 'source' | 'connection_id' | 'node' | 'target_storage' | 'network_mode' | 'bridge'>

/** Source, target and isolation: the fields a schedule shares with a drill. */
function parseTarget(b: Record<string, unknown>): ParseResult<TargetFields> {
  const src = obj(b.source)
  const required = {
    'source.pbs_id': str(src.pbs_id),
    'source.datastore': str(src.datastore),
    connection_id: str(b.connection_id),
    node: str(b.node),
    target_storage: str(b.target_storage),
  }
  const missing = Object.entries(required).find(([, v]) => !v)
  if (missing) return { ok: false, error: `${missing[0]} is required` }
  if (!PVE_NAME_RE.test(required.node)) return { ok: false, error: 'node is invalid' }
  if (!PVE_NAME_RE.test(required.target_storage)) return { ok: false, error: 'target_storage is invalid' }

  const networkMode = str(b.network_mode) || 'link_down'
  if (!NETWORK_MODES.includes(networkMode as DrillNetworkMode)) return { ok: false, error: 'network_mode must be link_down or bridge' }
  const bridge = networkMode === 'bridge' ? str(b.bridge) : ''
  if (networkMode === 'bridge' && !PVE_NAME_RE.test(bridge)) return { ok: false, error: 'bridge is required when network_mode is bridge' }

  return {
    ok: true,
    value: {
      source: { pbs_id: required['source.pbs_id'], datastore: required['source.datastore'], namespace: normalizeNamespace(src.namespace) },
      connection_id: required.connection_id,
      node: required.node,
      target_storage: required.target_storage,
      network_mode: networkMode as DrillNetworkMode,
      bridge,
    },
  }
}

function parseVmsPerRun(raw: unknown): ParseResult<number> {
  const perRun = typeof raw === 'number' ? raw : Number(raw ?? 1)
  const [min, max] = SCHEDULE_LIMITS.vmsPerRun
  if (!Number.isInteger(perRun) || perRun < min || perRun > max) {
    return { ok: false, error: `vms_per_run must be an integer between ${min} and ${max}` }
  }
  return { ok: true, value: perRun }
}

/** Validates the schedule body. Only the shape: authorisation and resolution come after. */
export function parseScheduleBody(body: unknown): ParseResult<ScheduleBody> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Invalid body' }
  const b = body as Record<string, unknown>

  const name = str(b.name)
  if (!name || name.length > SCHEDULE_LIMITS.nameMax) return { ok: false, error: `name must be 1 to ${SCHEDULE_LIMITS.nameMax} characters` }
  if (b.enabled !== undefined && typeof b.enabled !== 'boolean') return { ok: false, error: 'enabled must be a boolean' }

  const scope = parseScope(b.scope)
  if (scope.ok === false) return scope

  const restorePoint = str(b.restore_point) || 'latest'
  if (!SCHEDULE_RESTORE_POINTS.includes(restorePoint as ScheduleRestorePoint)) {
    return { ok: false, error: 'restore_point must be latest or latest_verified' }
  }

  const target = parseTarget(b)
  if (target.ok === false) return target
  const calendar = parseCalendar(b.calendar)
  if (calendar.ok === false) return calendar
  const perRun = parseVmsPerRun(b.vms_per_run)
  if (perRun.ok === false) return perRun

  return {
    ok: true,
    value: {
      name,
      enabled: b.enabled !== false,
      scope: scope.value,
      restore_point: restorePoint as ScheduleRestorePoint,
      ...target.value,
      calendar: calendar.value,
      vms_per_run: perRun.value,
    },
  }
}

export function toScheduleInput(
  body: ScheduleBody,
  resolved: { pbsName: string; pbsStorage: string; createdBy: string },
): ScheduleInput {
  return {
    ...body,
    scope: { mode: body.scope.mode, vmids: [...body.scope.vmids] },
    source: { ...body.source, pbs_name: resolved.pbsName, pbs_storage: resolved.pbsStorage },
    created_by: resolved.createdBy,
  }
}

/** What the audit log keeps of a schedule: where it reads, where it restores, when. */
export function scheduleAuditDetails(input: ScheduleInput) {
  return {
    enabled: input.enabled,
    scope: input.scope.mode,
    vmids: input.scope.vmids,
    restorePoint: input.restore_point,
    pbsId: input.source.pbs_id,
    datastore: input.source.datastore,
    namespace: input.source.namespace,
    pbsStorage: input.source.pbs_storage,
    connectionId: input.connection_id,
    node: input.node,
    targetStorage: input.target_storage,
    networkMode: input.network_mode,
    ...(input.bridge ? { bridge: input.bridge } : {}),
    calendar: input.calendar,
    vmsPerRun: input.vms_per_run,
  }
}

// ---------------------------------------------------------------------------
// Modal form
// ---------------------------------------------------------------------------

export interface ScheduleFormState {
  name: string
  enabled: boolean
  pbsId: string
  datastore: string
  namespace: string
  scopeMode: ScheduleScopeMode
  vmids: number[]
  restorePoint: ScheduleRestorePoint
  connId: string
  node: string
  storage: string
  networkMode: DrillNetworkMode
  bridge: string
  calendar: string
  vmsPerRun: number
}

export type ScheduleFormField = 'name' | 'source' | 'vmids' | 'target' | 'bridge' | 'calendar' | 'vmsPerRun'

export const EMPTY_SCHEDULE_FORM: ScheduleFormState = {
  name: '',
  enabled: true,
  pbsId: '',
  datastore: '',
  namespace: '',
  scopeMode: 'vms',
  vmids: [],
  restorePoint: 'latest',
  connId: '',
  node: '',
  storage: '',
  networkMode: 'link_down',
  bridge: '',
  calendar: '02:00',
  vmsPerRun: 1,
}

const F = 'backups.restoreDrills.schedules.form'

function nameError(raw: string): string | null {
  const name = raw.trim()
  if (!name) return `${F}.errNameRequired`
  return name.length > SCHEDULE_LIMITS.nameMax ? `${F}.errNameTooLong` : null
}

function vmidsError(form: Pick<ScheduleFormState, 'scopeMode' | 'vmids'>): string | null {
  if (form.scopeMode !== 'vms') return null
  if (form.vmids.length === 0) return `${F}.errVmids`
  return form.vmids.length > SCHEDULE_LIMITS.vmidsMax ? `${F}.errVmidsTooMany` : null
}

/** Inline errors of the modal, as i18n keys by field: empty when the form can be saved. */
export function scheduleFormErrors(form: ScheduleFormState): Partial<Record<ScheduleFormField, string>> {
  const errors: Partial<Record<ScheduleFormField, string>> = {}
  const name = nameError(form.name)
  if (name) errors.name = name
  if (!form.pbsId || !form.datastore) errors.source = `${F}.errSource`
  const vmids = vmidsError(form)
  if (vmids) errors.vmids = vmids
  if (!form.connId || !form.node || !form.storage) errors.target = `${F}.errTarget`
  if (form.networkMode === 'bridge' && !form.bridge) errors.bridge = `${F}.errBridge`
  if (!form.calendar.trim()) errors.calendar = `${F}.errCalendar`
  const [min, max] = SCHEDULE_LIMITS.vmsPerRun
  if (!Number.isInteger(form.vmsPerRun) || form.vmsPerRun < min || form.vmsPerRun > max) errors.vmsPerRun = `${F}.errVmsPerRun`
  return errors
}

export function scheduleFormToBody(form: ScheduleFormState): ScheduleBody {
  return {
    name: form.name.trim(),
    enabled: form.enabled,
    scope: { mode: form.scopeMode, vmids: form.scopeMode === 'vms' ? [...form.vmids].sort((a, b) => a - b) : [] },
    restore_point: form.restorePoint,
    source: { pbs_id: form.pbsId, datastore: form.datastore, namespace: form.namespace },
    connection_id: form.connId,
    node: form.node,
    target_storage: form.storage,
    network_mode: form.networkMode,
    bridge: form.networkMode === 'bridge' ? form.bridge : '',
    calendar: form.calendar.trim(),
    vms_per_run: form.vmsPerRun,
  }
}

export function scheduleToForm(schedule: Schedule): ScheduleFormState {
  return {
    name: schedule.name || '',
    enabled: !!schedule.enabled,
    pbsId: schedule.source?.pbs_id || '',
    datastore: schedule.source?.datastore || '',
    namespace: schedule.source?.namespace || '',
    scopeMode: schedule.scope?.mode === 'all' ? 'all' : 'vms',
    vmids: [...(schedule.scope?.vmids ?? [])],
    restorePoint: schedule.restore_point === 'latest_verified' ? 'latest_verified' : 'latest',
    connId: schedule.connection_id || '',
    node: schedule.node || '',
    storage: schedule.target_storage || '',
    networkMode: schedule.network_mode === 'bridge' ? 'bridge' : 'link_down',
    bridge: schedule.bridge || '',
    calendar: schedule.calendar || '',
    vmsPerRun: schedule.vms_per_run || 1,
  }
}

/** Body of a PUT that only flips `enabled`, everything else as stored. */
export function scheduleToggleBody(schedule: Schedule, enabled: boolean): ScheduleBody {
  return scheduleFormToBody({ ...scheduleToForm(schedule), enabled })
}

/** One VM a schedule can target, from the snapshots of a PBS datastore. */
export interface ScheduleVmOption {
  vmid: number
  name: string
  namespace: string
}

/** VMs (not CTs) that have at least one snapshot, per namespace, newest name kept. */
export function vmOptionsFromSnapshots(
  snapshots: ReadonlyArray<{ backupType?: string; backupId?: string | number; vmName?: string | null; namespace?: string | null; backupTime?: number | null }>,
): { namespaces: string[]; vms: ScheduleVmOption[] } {
  const namespaces = new Set<string>()
  const byKey = new Map<string, ScheduleVmOption & { at: number }>()
  for (const s of snapshots) {
    if (s.backupType !== 'vm') continue
    const vmid = Number(s.backupId)
    if (!Number.isInteger(vmid) || vmid < 1) continue
    const ns = normalizeNamespace(s.namespace)
    namespaces.add(ns)
    const key = `${ns}|${vmid}`
    const at = s.backupTime || 0
    const prev = byKey.get(key)
    if (!prev || (at >= prev.at && s.vmName)) byKey.set(key, { vmid, namespace: ns, name: s.vmName || prev?.name || '', at })
  }
  const vms = [...byKey.values()].map(({ vmid, name, namespace }) => ({ vmid, name, namespace })).sort((a, b) => a.vmid - b.vmid)
  const nsList = [...namespaces].sort((a, b) => {
    if (a === '') return -1
    if (b === '') return 1
    return a.localeCompare(b)
  })
  return { namespaces: nsList, vms }
}
