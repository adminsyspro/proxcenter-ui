import type { ParsedBody } from './service'

/*
   The pveceph commands ProxCenter runs over SSH (ui#1450), as argument lists:
   PVE refuses OSD creation and destruction to an API token ("Permission check
   failed (user != root@pam)", measured on PVE 9.2, 28/11/2026) and has no API
   to install the Ceph packages. Each list matches one pinned rule of the
   ceph-provisioning sudo profile (lib/ssh/sudo); every value is checked here
   before it reaches a command line.
*/

export const PVECEPH = '/usr/bin/pveceph'

export const CEPH_RELEASES = ['tentacle', 'squid'] as const
export type CephRelease = (typeof CEPH_RELEASES)[number]
export const CEPH_REPOSITORIES = ['enterprise', 'no-subscription', 'manual'] as const
export type CephRepository = (typeof CEPH_REPOSITORIES)[number]

export interface OsdCreateInput {
  dev: string
  dbDev?: string
  dbSizeGiB?: number
  walDev?: string
  walSizeGiB?: number
  encrypted?: boolean
  deviceClass?: string
}

// Same grammar as BLOCK_DEV of the sudo rule: no dot, so no `..`.
const BLOCK_DEV_RE = /^\/dev\/[A-Za-z0-9][A-Za-z0-9/_-]*$/
const DEVICE_CLASS_RE = /^[a-z0-9_-]{1,32}$/
const MAX_GIB = 65_536

export function isBlockDevice(value: unknown): value is string {
  return typeof value === 'string' && BLOCK_DEV_RE.test(value)
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

function gib(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_GIB ? value : null
}

/** One optional side device (block.db or block.wal) and its size. */
function sideDevice(dev: unknown, size: unknown, label: string, out: OsdCreateInput, key: 'db' | 'wal'): string | null {
  if (isBlank(dev)) return isBlank(size) ? null : `A ${label} size needs a ${label} device`
  if (!isBlockDevice(dev)) return `Invalid ${label} device`
  out[key === 'db' ? 'dbDev' : 'walDev'] = dev
  if (isBlank(size)) return null
  const n = gib(size)
  if (n === null) return `The ${label} size must be a whole number of GiB from 1 to ${MAX_GIB}`
  out[key === 'db' ? 'dbSizeGiB' : 'walSizeGiB'] = n
  return null
}

export function parseOsdCreate(body: unknown): ParsedBody<OsdCreateInput> {
  const b = (body ?? {}) as Record<string, unknown>
  if (!isBlockDevice(b.dev)) return { ok: false, error: 'Invalid device: a /dev path of the node is expected' }
  const out: OsdCreateInput = { dev: b.dev }

  const dbError = sideDevice(b.dbDev, b.dbSizeGiB, 'DB', out, 'db')
  if (dbError) return { ok: false, error: dbError }
  const walError = sideDevice(b.walDev, b.walSizeGiB, 'WAL', out, 'wal')
  if (walError) return { ok: false, error: walError }
  if ((out.dbDev && out.dbDev === out.dev) || (out.walDev && out.walDev === out.dev)) {
    return { ok: false, error: 'The DB and WAL devices must differ from the OSD device' }
  }

  if (b.encrypted === true) out.encrypted = true
  if (!isBlank(b.deviceClass)) {
    if (typeof b.deviceClass !== 'string' || !DEVICE_CLASS_RE.test(b.deviceClass)) return { ok: false, error: 'Invalid device class' }
    out.deviceClass = b.deviceClass
  }
  return { ok: true, params: out }
}

/** `pveceph osd create`, its options in the order the sudo rule pins them. */
export function osdCreateArgv(input: OsdCreateInput): string[] {
  const argv = [PVECEPH, 'osd', 'create', input.dev]
  if (input.dbDev) {
    argv.push('--db_dev', input.dbDev)
    if (input.dbSizeGiB) argv.push('--db_dev_size', String(input.dbSizeGiB))
  }
  if (input.walDev) {
    argv.push('--wal_dev', input.walDev)
    if (input.walSizeGiB) argv.push('--wal_dev_size', String(input.walSizeGiB))
  }
  if (input.encrypted) argv.push('--encrypted', '1')
  if (input.deviceClass) argv.push('--crush-device-class', input.deviceClass)
  return argv
}

export function osdDestroyArgv(osd: number, cleanup: boolean): string[] {
  return [PVECEPH, 'osd', 'destroy', String(osd), ...(cleanup ? ['--cleanup', '1'] : [])]
}

export function parseCephInstall(body: unknown): ParsedBody<{ version: CephRelease; repository: CephRepository }> {
  const b = (body ?? {}) as Record<string, unknown>
  if (!CEPH_RELEASES.includes(b.version as CephRelease)) return { ok: false, error: 'Ceph version must be tentacle or squid' }
  if (!CEPH_REPOSITORIES.includes(b.repository as CephRepository)) return { ok: false, error: 'Repository must be enterprise, no-subscription or manual' }
  return { ok: true, params: { version: b.version as CephRelease, repository: b.repository as CephRepository } }
}

/** `pveceph install`, never with the test repository nor an experimental release. */
export function installArgv(version: CephRelease, repository: CephRepository): string[] {
  return [PVECEPH, 'install', '--version', version, '--repository', repository]
}
