import type { ParsedBody } from './service'

/*
   Parameters of a replicated Ceph pool (ui#1450), checked on the server before
   `POST /nodes/{n}/ceph/pool` or `PUT /nodes/{n}/ceph/pool/{name}`. The dialogs
   send this shape; the routes hand PVE the form fields built here.

   pg_num starts at 32 with the autoscaler on: PVE's default of 128 failed in
   the task on a 3-OSD cluster (mon_max_pg_per_osd 250, measured on the lab on
   28/11/2026), the autoscaler grows the pool from there.
*/

export type PoolAutoscale = 'on' | 'warn' | 'off'
export type PoolApplication = 'rbd' | 'cephfs' | 'rgw'

export interface PoolFormInput {
  name: string
  size: number
  minSize: number
  /** min_size 1 accepts writes on a single copy: only on an explicit choice. */
  allowSingleCopy?: boolean
  crushRule?: string
  autoscale: PoolAutoscale
  targetRatio?: number
  targetSizeGiB?: number
  application: PoolApplication
  addStorage: boolean
}

export const POOL_DEFAULTS: PoolFormInput = {
  name: '',
  size: 3,
  minSize: 2,
  autoscale: 'on',
  application: 'rbd',
  addStorage: true,
}

export const POOL_INITIAL_PG_NUM = 32
export const POOL_MAX_SIZE = 7

const POOL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const CRUSH_RULE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const AUTOSCALE: readonly PoolAutoscale[] = ['on', 'warn', 'off']
const APPLICATIONS: readonly PoolApplication[] = ['rbd', 'cephfs', 'rgw']
const GIB = 1024 ** 3

export function isPoolName(value: unknown): value is string {
  return typeof value === 'string' && POOL_NAME_RE.test(value)
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

function intIn(value: unknown, min: number, max: number): number | null {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max ? n : null
}

type Fields = Record<string, string>

/** size, min_size, autoscale, rule and target: the fields creation and edit share. */
function parseShared(b: Record<string, unknown>): ParsedBody<Fields> {
  const size = intIn(b.size, 1, POOL_MAX_SIZE)
  if (size === null) return { ok: false, error: `Size must be a whole number from 1 to ${POOL_MAX_SIZE}` }
  const minSize = intIn(b.minSize, 1, POOL_MAX_SIZE)
  if (minSize === null || minSize > size) return { ok: false, error: 'Min. size must be a whole number from 1 to the size' }
  if (minSize === 1 && b.allowSingleCopy !== true) {
    return { ok: false, error: 'Min. size 1 accepts writes on a single copy: confirm it explicitly' }
  }
  const autoscale = b.autoscale ?? 'on'
  if (!AUTOSCALE.includes(autoscale as PoolAutoscale)) return { ok: false, error: 'PG autoscale mode must be on, warn or off' }

  const params: Fields = { size: String(size), min_size: String(minSize), pg_autoscale_mode: String(autoscale) }

  if (!isBlank(b.crushRule)) {
    if (typeof b.crushRule !== 'string' || !CRUSH_RULE_RE.test(b.crushRule)) return { ok: false, error: 'Invalid CRUSH rule name' }
    params.crush_rule = b.crushRule
  }

  const hasRatio = !isBlank(b.targetRatio)
  const hasSize = !isBlank(b.targetSizeGiB)
  if (hasRatio && hasSize) return { ok: false, error: 'Set a target ratio or a target size, not both' }
  if (hasRatio) {
    const ratio = Number(b.targetRatio)
    if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) return { ok: false, error: 'Target ratio must be between 0 and 1' }
    params.target_size_ratio = String(ratio)
  }
  if (hasSize) {
    const gib = intIn(b.targetSizeGiB, 1, 1024 * 1024)
    if (gib === null) return { ok: false, error: 'Target size must be a whole number of GiB' }
    params.target_size = String(gib * GIB)
  }

  return { ok: true, params }
}

/** The form body of `POST /nodes/{n}/ceph/pool`. */
export function parsePoolCreate(body: unknown): ParsedBody<Fields> {
  const b = (body ?? {}) as Record<string, unknown>
  if (!isPoolName(b.name)) return { ok: false, error: 'Pool name: letters, digits, dot, dash and underscore, 64 characters at most' }
  const application = b.application ?? 'rbd'
  if (!APPLICATIONS.includes(application as PoolApplication)) return { ok: false, error: 'Application must be rbd, cephfs or rgw' }
  const shared = parseShared(b)
  if (shared.ok === false) return shared
  const { size, min_size, pg_autoscale_mode, ...rest } = shared.params

  return {
    ok: true,
    params: {
      name: b.name,
      size,
      min_size,
      pg_num: String(POOL_INITIAL_PG_NUM),
      pg_autoscale_mode,
      ...rest,
      application: String(application),
      add_storages: b.addStorage === false ? '0' : '1',
    },
  }
}

/** The form body of `PUT /nodes/{n}/ceph/pool/{name}`: name, application and storage stay as they are. */
export function parsePoolUpdate(body: unknown): ParsedBody<Fields> {
  return parseShared((body ?? {}) as Record<string, unknown>)
}
