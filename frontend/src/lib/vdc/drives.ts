// src/lib/vdc/drives.ts
// PVE drive-string parsing + tenant scope validation + storage-policy QoS
// stamping. Pure module: the disk-side counterpart of vnets.ts's
// validateNetAgainstScope, with the same fail-closed stance (lowercase keys
// only, duplicate keys refused, unknown shapes refused for tenants).

export const QOS_KEYS: ReadonlySet<string> = new Set([
  'mbps', 'mbps_max', 'mbps_rd', 'mbps_rd_max', 'mbps_wr', 'mbps_wr_max',
  'iops', 'iops_max', 'iops_rd', 'iops_rd_max', 'iops_wr', 'iops_wr_max',
  'iops_max_length', 'iops_rd_max_length', 'iops_wr_max_length',
])

export const DATA_DISK_KEY_RE = /^(scsi|virtio|ide|sata)\d+$/
export const AUX_DISK_KEY_RE = /^(efidisk|tpmstate|unused)\d+$/
export const LXC_DISK_KEY_RE = /^rootfs$|^mp\d+$/

export interface ParsedDrive {
  storage: string | null
  head: string
  opts: Array<[string, string]>
  isCdrom: boolean
  newAllocationGb: number | null
}

export interface DriveQosCaps {
  iopsRd: number | null
  iopsWr: number | null
  mbpsRd: number | null
  mbpsWr: number | null
}

export function isTenantDiskKey(key: string, type: 'qemu' | 'lxc'): boolean {
  // unusedN is included for lxc too: the config route forwards it to PVE
  // (foreign volid reattach) regardless of guest type, so it must be
  // validated against scope for lxc the same way it is for qemu.
  if (type === 'lxc') return LXC_DISK_KEY_RE.test(key) || /^unused\d+$/.test(key)
  return DATA_DISK_KEY_RE.test(key) || AUX_DISK_KEY_RE.test(key)
}

const OPT_RE = /^([a-z][a-z0-9_-]*)=(.*)$/

// The volume part after "storage:" must look like a PVE volid segment
// (vm-100-disk-0, iso/debian.iso, 100/vm-100-disk-0.qcow2, or a bare decimal
// size) and never a raw filesystem path smuggled behind a valid storage
// prefix (ceph-nvme:/dev/sda, ceph-nvme:../../etc/shadow). Space, parens and
// "+" are allowed: real ISO filenames carry them (e.g.
// "Win10_22H2 (x64).iso"), and refusing them broke legitimate
// EditDiskDialog re-saves without adding any actual scope protection (no
// leading slash, no ':', no backslash, and the ".." segment refusal all
// still hold).
const VOLUME_REST_RE = /^[A-Za-z0-9][A-Za-z0-9._+ ()/-]*$/

function hasDotDotSegment(rest: string): boolean {
  return rest.split('/').includes('..')
}

function isValidVolumeRest(rest: string): boolean {
  return VOLUME_REST_RE.test(rest) && !hasDotDotSegment(rest)
}

export function parseDriveString(raw: string):
  { ok: true; drive: ParsedDrive } | { ok: false; error: string } {
  const value = String(raw ?? '').trim()
  if (!value) return { ok: false, error: 'Empty drive value' }

  const parts = value.split(',')
  const head = parts[0].trim()
  const opts: Array<[string, string]> = []
  const seen = new Set<string>()

  for (const part of parts.slice(1)) {
    const m = part.trim().match(OPT_RE)
    if (!m) return { ok: false, error: `Unsupported drive option "${part.trim()}"` }
    if (seen.has(m[1])) return { ok: false, error: `Duplicate drive option "${m[1]}"` }
    seen.add(m[1])
    opts.push([m[1], m[2]])
  }

  const isCdrom = opts.some(([k, v]) => k === 'media' && v === 'cdrom')

  if (head === 'none') {
    return { ok: true, drive: { storage: null, head, opts, isCdrom, newAllocationGb: null } }
  }

  // Only the volid shape "<storage>:<rest>" is accepted: a bare path
  // (/dev/..., /root/x.qcow2) is host passthrough, never legitimate for a
  // restricted tenant. The storage name charset mirrors PVE storage ids.
  const idx = head.indexOf(':')
  if (idx <= 0 || head.startsWith('/')) {
    return { ok: false, error: `Unsupported drive reference "${head}" (expected storage:volume)` }
  }
  const storage = head.slice(0, idx)
  if (!/^[A-Za-z][A-Za-z0-9._-]*$/.test(storage)) {
    return { ok: false, error: `Invalid storage name "${storage}"` }
  }
  const rest = head.slice(idx + 1)
  if (!isValidVolumeRest(rest)) {
    return { ok: false, error: `Unsupported volume reference "${rest}"` }
  }
  const sizeMatch = rest.match(/^(\d+(?:\.\d+)?)$/)
  const newAllocationGb = sizeMatch ? Number.parseFloat(sizeMatch[1]) : null

  return { ok: true, drive: { storage, head, opts, isCdrom, newAllocationGb } }
}

/** Volid inside import-from= must itself point at an in-scope storage, and
 *  its own volume part is held to the same shape rule as the main drive
 *  reference (no raw path smuggled behind a valid storage prefix). */
function importFromStorage(opts: Array<[string, string]>): string | null | undefined {
  const entry = opts.find(([k]) => k === 'import-from')
  if (!entry) return undefined
  const v = entry[1]
  const idx = v.indexOf(':')
  if (idx <= 0 || v.startsWith('/')) return null // unsupported shape
  const rest = v.slice(idx + 1)
  if (!isValidVolumeRest(rest)) return null
  return v.slice(0, idx)
}

export function validateDriveAgainstScope(
  key: string,
  raw: string,
  allowedStorages: Set<string>,
): { ok: true; drive: ParsedDrive } | { ok: false; error: string } {
  const parsed = parseDriveString(raw)
  if (parsed.ok === false) return { ok: false, error: `${key}: ${parsed.error}` }
  const { drive } = parsed

  if (drive.storage !== null && !allowedStorages.has(drive.storage)) {
    return { ok: false, error: `${key}: storage "${drive.storage}" is not authorised for this tenant.` }
  }
  const impStorage = importFromStorage(drive.opts)
  if (impStorage === null) {
    return { ok: false, error: `${key}: unsupported import-from reference (expected storage:volume)` }
  }
  if (impStorage !== undefined && !allowedStorages.has(impStorage)) {
    return { ok: false, error: `${key}: import storage "${impStorage}" is not authorised for this tenant.` }
  }
  return { ok: true, drive }
}

const CAP_ORDER: Array<[keyof DriveQosCaps, string]> = [
  ['iopsRd', 'iops_rd'], ['iopsWr', 'iops_wr'], ['mbpsRd', 'mbps_rd'], ['mbpsWr', 'mbps_wr'],
]

export function policyQosSuffix(caps: DriveQosCaps | undefined): string {
  if (!caps) return ''
  const parts = CAP_ORDER
    .filter(([field]) => caps[field] !== null && caps[field] !== undefined)
    .map(([field, key]) => `${key}=${caps[field]}`)
  return parts.length > 0 ? `,${parts.join(',')}` : ''
}

/** "32G" | "512M" | "1T" | "8192" (implicit MB) -> integer MB. Returns 0 for
 *  anything unparseable (caller treats 0 as "nothing to meter"). */
export function parsePveSizeToMb(size: string): number {
  const m = String(size).trim().match(/^(\d+(?:\.\d+)?)([KMGT])?$/i)
  if (!m) return 0
  const v = Number.parseFloat(m[1])
  const unit = (m[2] || 'M').toUpperCase()
  if (unit === 'T') return Math.round(v * 1024 * 1024)
  if (unit === 'G') return Math.round(v * 1024)
  if (unit === 'K') return Math.round(v / 1024)
  return Math.round(v)
}

/** Strip-and-stamp: caller only invokes this on DATA disk keys of a
 *  policied storage. No policy = raw preserved verbatim (spec Section 5.2).
 *  isCdrom is deliberately NOT exempted here: a tenant could spoof
 *  media=cdrom on an actual data disk to dodge the QoS caps, and a genuine
 *  capped cdrom line is harmless. Only a parse failure or a storage-less
 *  line (e.g. "none,media=cdrom") passes through untouched. */
export function stampDriveQos(raw: string, caps: DriveQosCaps | undefined): string {
  if (!caps) return raw
  const parsed = parseDriveString(raw)
  if (parsed.ok === false || parsed.drive.storage === null) return raw
  const kept = parsed.drive.opts.filter(([k]) => !QOS_KEYS.has(k))
  const base = [parsed.drive.head, ...kept.map(([k, v]) => `${k}=${v}`)].join(',')
  return `${base}${policyQosSuffix(caps)}`
}
