/**
 * Cluster storage types ProxCenter adds, edits and removes (roadmap#202), as
 * Proxmox's `storage.cfg` knows them. Pure data shared by the routes and the
 * dialog: which fields a type takes, which are fixed once created, which are
 * secrets, which contents it may hold, which scan tests it.
 */

export const CLUSTER_STORAGE_TYPES = ['nfs', 'cifs', 'iscsi', 'lvm', 'rbd', 'cephfs', 'zfs', 'dir'] as const
export type ClusterStorageType = (typeof CLUSTER_STORAGE_TYPES)[number]

export const isClusterStorageType = (t: unknown): t is ClusterStorageType =>
  typeof t === 'string' && (CLUSTER_STORAGE_TYPES as readonly string[]).includes(t)

/** Proxmox's `pve-storage-id`. */
export const STORAGE_ID_RE = /^[A-Za-z][A-Za-z0-9\-_.]*[A-Za-z0-9]$/

export type FieldKind = 'text' | 'secret' | 'boolean' | 'select'

export type StorageField = {
  /** The Proxmox parameter. */
  key: string
  kind: FieldKind
  required?: boolean
  /** Proxmox refuses to change it after creation. */
  fixed?: boolean
  /** Choices of a select. */
  options?: readonly string[]
  /** Required only when another field has this value. */
  requiredWhen?: { key: string; value: string }
  /** Shown only when another field has this value. */
  shownWhen?: { key: string; value: string }
}

export type StorageTypeSpec = {
  fields: readonly StorageField[]
  /** Contents the type may hold, the first one being the default. */
  contents: readonly string[]
  /** `shared` is a choice of the operator (it is implied for the network types). */
  sharedChoice: boolean
  /** The PVE scan that tests the target before saving, when Proxmox has one. */
  scan: 'nfs' | 'cifs' | 'iscsi' | 'lvm' | null
}

const FILE_CONTENTS = ['images', 'rootdir', 'vztmpl', 'iso', 'backup', 'snippets', 'import'] as const

export const STORAGE_TYPE_SPECS: Record<ClusterStorageType, StorageTypeSpec> = {
  // `fixed`: what each PVE 9 storage plugin declares `fixed => 1` in its options.
  nfs: {
    fields: [
      { key: 'server', kind: 'text', required: true, fixed: true },
      { key: 'export', kind: 'text', required: true, fixed: true },
      { key: 'options', kind: 'text' },
    ],
    contents: FILE_CONTENTS,
    sharedChoice: false,
    scan: 'nfs',
  },
  cifs: {
    fields: [
      { key: 'server', kind: 'text', required: true, fixed: true },
      { key: 'username', kind: 'text' },
      { key: 'password', kind: 'secret' },
      { key: 'domain', kind: 'text' },
      { key: 'share', kind: 'text', required: true, fixed: true },
      { key: 'smbversion', kind: 'select', options: ['default', '2.0', '2.1', '3', '3.0', '3.11'] },
      { key: 'subdir', kind: 'text' },
    ],
    contents: FILE_CONTENTS,
    sharedChoice: false,
    scan: 'cifs',
  },
  iscsi: {
    fields: [
      { key: 'portal', kind: 'text', required: true, fixed: true },
      { key: 'target', kind: 'text', required: true, fixed: true },
    ],
    // `images` uses the LUNs directly, `none` keeps them for an LVM on top.
    contents: ['images', 'none'],
    sharedChoice: false,
    scan: 'iscsi',
  },
  lvm: {
    fields: [
      { key: 'base', kind: 'text', fixed: true },
      { key: 'vgname', kind: 'text', required: true, fixed: true },
      { key: 'saferemove', kind: 'boolean' },
    ],
    contents: ['images', 'rootdir'],
    sharedChoice: true,
    scan: 'lvm',
  },
  rbd: {
    fields: [
      { key: 'monhost', kind: 'text', required: true },
      { key: 'pool', kind: 'text', required: true },
      { key: 'username', kind: 'text', required: true },
      { key: 'keyring', kind: 'secret', required: true },
      { key: 'krbd', kind: 'boolean' },
    ],
    contents: ['images', 'rootdir'],
    sharedChoice: false,
    scan: null,
  },
  cephfs: {
    fields: [
      { key: 'monhost', kind: 'text', required: true },
      { key: 'username', kind: 'text', required: true },
      // The client key: Proxmox takes it in `keyring` for an external CephFS too.
      { key: 'keyring', kind: 'secret', required: true },
      { key: 'fs-name', kind: 'text' },
    ],
    contents: ['vztmpl', 'iso', 'backup', 'snippets', 'import'],
    sharedChoice: false,
    scan: null,
  },
  zfs: {
    fields: [
      { key: 'portal', kind: 'text', required: true, fixed: true },
      { key: 'pool', kind: 'text', required: true, fixed: true },
      { key: 'target', kind: 'text', required: true, fixed: true },
      { key: 'iscsiprovider', kind: 'select', required: true, fixed: true, options: ['LIO', 'comstar', 'istgt', 'iet'] },
      { key: 'lio_tpg', kind: 'text', requiredWhen: { key: 'iscsiprovider', value: 'LIO' }, shownWhen: { key: 'iscsiprovider', value: 'LIO' } },
      { key: 'blocksize', kind: 'text', fixed: true },
      { key: 'sparse', kind: 'boolean' },
      { key: 'nowritecache', kind: 'boolean' },
    ],
    contents: ['images'],
    sharedChoice: false,
    scan: 'iscsi',
  },
  dir: {
    fields: [
      { key: 'path', kind: 'text', required: true, fixed: true },
      { key: 'is_mountpoint', kind: 'boolean' },
    ],
    contents: FILE_CONTENTS,
    sharedChoice: true,
    scan: null,
  },
}

/** Parameters every type takes, edited the same way. */
export const BWLIMIT_KINDS = ['default', 'migration', 'restore', 'clone', 'move'] as const
export type BwlimitKind = (typeof BWLIMIT_KINDS)[number]

/** The Proxmox keys whose value never leaves the server once written. */
export const SECRET_KEYS = ['password', 'keyring', 'encryption-key', 'master-pubkey'] as const

/** A scalar as text; an object, an array or nothing as ''. */
export function asText(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return ''
}

/** MiB/s per kind as the dialog holds them, or null for no limit. */
export type BwlimitMiB = Partial<Record<BwlimitKind, number | null>>

/** `clone=1024,default=2048` (KiB/s) → MiB/s per kind. */
export function parseBwlimit(raw: unknown): BwlimitMiB {
  const out: BwlimitMiB = {}
  for (const part of asText(raw).split(',')) {
    const [k, v] = part.split('=').map(s => s.trim())
    const kib = Number(v)
    if ((BWLIMIT_KINDS as readonly string[]).includes(k) && Number.isFinite(kib) && kib > 0) out[k as BwlimitKind] = Math.round(kib / 1024)
  }
  return out
}

/** MiB/s per kind → the Proxmox property string (KiB/s), or '' for no limit at all. */
export function formatBwlimit(limits: BwlimitMiB | null | undefined): string {
  return BWLIMIT_KINDS
    .filter(k => typeof limits?.[k] === 'number' && (limits[k] as number) > 0)
    .map(k => `${k}=${Math.round((limits![k] as number) * 1024)}`)
    .join(',')
}
