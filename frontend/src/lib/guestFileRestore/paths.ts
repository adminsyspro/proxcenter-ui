// src/lib/guestFileRestore/paths.ts
//
// Pure path arithmetic of the guest file restore: where a file-restore path
// lands inside the guest, for both OS families, and the names tried when the
// target already exists. No I/O here, everything is unit-tested.

import type { GuestOs, GuestRestoreDestination } from './types'

export const PXAR_SUFFIX = '.pxar.didx'
export const IMG_SUFFIX = '.img.fidx'

/** Segments of a posix-like path, without the empty and `.` ones. */
export function posixSegments(p: string): string[] {
  return p.split('/').filter(s => s !== '' && s !== '.')
}

/** True when a path climbs out of its root (`..` segment, on either separator). */
export function hasParentSegment(p: string): boolean {
  return p.split(/[\\/]/).some(s => s === '..')
}

export function posixBasename(p: string): string {
  const segs = posixSegments(p)
  return segs.length ? segs[segs.length - 1] : ''
}

export function posixDirname(p: string): string {
  const segs = posixSegments(p)
  segs.pop()
  return '/' + segs.join('/')
}

export interface ArchivePathParts {
  /** The file-restore prefix that names the archive (and partition / LV). */
  volumeRoot: string
  /** The path inside the guest filesystem, always absolute. */
  inner: string
}

/**
 * Split a PVE file-restore path into the archive prefix and the path inside
 * the guest filesystem:
 *   /root.pxar.didx/etc/hosts                         -> /root.pxar.didx + /etc/hosts
 *   /drive-scsi0.img.fidx/part/2/etc/hosts            -> 3 segments + /etc/hosts
 *   /drive-scsi0.img.fidx/lvm/vg0/root/etc/hosts      -> 4 segments + /etc/hosts
 *   /drive-scsi0.img.fidx/<kind>/<name>/etc/hosts     -> 3 segments + /etc/hosts
 * A path with no recognised archive is returned whole as `inner`.
 */
export function splitArchivePath(fullPath: string): ArchivePathParts {
  const segs = posixSegments(fullPath)
  if (segs.length === 0) return { volumeRoot: '', inner: '/' }
  const archive = segs[0]
  let rootLen = 0
  if (archive.endsWith(PXAR_SUFFIX)) {
    rootLen = 1
  } else if (archive.endsWith(IMG_SUFFIX)) {
    rootLen = segs[1] === 'lvm' ? 4 : 3
  }
  if (rootLen === 0) return { volumeRoot: '', inner: '/' + segs.join('/') }
  const root = segs.slice(0, rootLen)
  const inner = segs.slice(rootLen)
  return { volumeRoot: '/' + root.join('/'), inner: '/' + inner.join('/') }
}

/** Guest-side path of an item: pbs paths are already guest paths, pve ones carry the archive prefix. */
export function innerPathOf(sourceKind: 'pve' | 'pbs', itemPath: string): string {
  if (sourceKind === 'pbs') return '/' + posixSegments(itemPath).join('/')
  return splitArchivePath(itemPath).inner
}

/**
 * Whether an explorer entry may be restored into a guest: it must sit INSIDE
 * a filesystem. An archive, a partition or an LV node is the whole
 * filesystem, and restoring it to its original location would rewrite the
 * guest's root; that is a full restore, not a file restore.
 */
export function isRestorableItemPath(sourceKind: 'pve' | 'pbs', itemPath: string): boolean {
  if (sourceKind === 'pbs') return posixSegments(itemPath).length > 0
  const { volumeRoot, inner } = splitArchivePath(itemPath)
  if (!volumeRoot) return false
  // An image path shorter than its volume root (`/x.img.fidx/part`) has the
  // root's segment count unmet: splitArchivePath then returns inner '/'.
  return inner !== '/'
}

function windowsSeparators(p: string): string {
  return p.replace(/\//g, '\\')
}

/** Drive-qualified Windows path of a posix-like absolute path: `/etc/x` with drive `C` -> `C:\etc\x`. */
export function toWindowsPath(posixLike: string, drive = 'C'): string {
  const segs = posixSegments(posixLike)
  const letter = (drive || 'C').charAt(0).toUpperCase()
  return `${letter}:\\${segs.join('\\')}`
}

/** Join a guest base directory and a posix relative path with the separator of the guest OS. */
export function joinGuestPath(os: GuestOs, base: string, relPath: string): string {
  const rel = posixSegments(relPath)
  if (os === 'windows') {
    let b = base.replace(/[\\/]+$/, '')
    if (/^[A-Za-z]:$/.test(b)) b += '\\'
    const prefix = b.endsWith('\\') ? b : b + '\\'
    return rel.length ? prefix + rel.map(windowsSeparators).join('\\') : b
  }
  const b = base.replace(/\/+$/, '') || ''
  return rel.length ? `${b}/${rel.join('/')}` : b || '/'
}

export interface GuestTargetPathInput {
  os: GuestOs
  destination: GuestRestoreDestination
  sourceKind: 'pve' | 'pbs'
  /** The item the entry belongs to (its full source path). */
  itemPath: string
  /** Entry path relative to the parent of the item, posix separators. */
  relPath: string
  /** Per-OS default custom folders from the settings. */
  defaults: { linux: string; windows: string }
}

/**
 * Where an entry is written in the guest.
 * - original: parent of the item inside the guest filesystem + relPath
 *   (Windows: on the chosen drive, default C).
 * - custom: the custom folder (or the per-OS default) + relPath.
 */
export function guestTargetPath(input: GuestTargetPathInput): string {
  const { os, destination, relPath } = input
  let base: string
  if (destination.mode === 'custom') {
    const custom = destination.path?.trim()
    base = custom || (os === 'windows' ? input.defaults.windows : input.defaults.linux)
  } else {
    const parent = posixDirname(innerPathOf(input.sourceKind, input.itemPath))
    base = os === 'windows' ? toWindowsPath(parent, destination.windowsDrive) : parent
  }
  return joinGuestPath(os, base, relPath)
}

/** Base directory of a custom destination as the runner resolves it (for logs and mkdir). */
export function customBaseDir(os: GuestOs, destination: GuestRestoreDestination, defaults: { linux: string; windows: string }): string {
  const custom = destination.path?.trim()
  return custom || (os === 'windows' ? defaults.windows : defaults.linux)
}

function splitLast(path: string, os: GuestOs): { dir: string; name: string } {
  const sep = os === 'windows' ? '\\' : '/'
  const idx = path.lastIndexOf(sep)
  if (idx < 0) return { dir: '', name: path }
  return { dir: path.slice(0, idx + 1), name: path.slice(idx + 1) }
}

/** `report.pdf` + 2 -> `report-2.pdf`; a dotfile or an extensionless name gets the suffix at the end. */
export function withCounter(name: string, n: number): string {
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return `${name}-${n}`
  return `${name.slice(0, dot)}-${n}${name.slice(dot)}`
}

/**
 * Names tried, in order, when the target exists and the conflict policy is
 * `keep`: `<dir>/<prefix><name>`, then `<dir>/<prefix><name-1>`, ... The
 * caller stops at the first free one.
 */
export function* keepBothCandidates(targetPath: string, os: GuestOs, prefix: string, max = 1000): Generator<string> {
  const { dir, name } = splitLast(targetPath, os)
  yield `${dir}${prefix}${name}`
  for (let n = 1; n <= max; n++) {
    yield `${dir}${prefix}${withCounter(name, n)}`
  }
}

/** Parent directory of a guest path, on either OS. */
export function guestDirname(path: string, os: GuestOs): string {
  const { dir } = splitLast(path, os)
  if (os === 'windows') {
    const trimmed = dir.replace(/\\+$/, '')
    return /^[A-Za-z]:$/.test(trimmed) ? trimmed + '\\' : trimmed
  }
  const trimmed = dir.replace(/\/+$/, '')
  return trimmed || '/'
}

/** Relative path accepted from a tar header: normalised posix, never absolute, never climbing. */
export function isSafeRelPath(rel: string): boolean {
  if (!rel) return false
  if (rel.startsWith('/') || rel.includes('\\')) return false
  if (/^[A-Za-z]:/.test(rel)) return false
  const segs = rel.split('/')
  return segs.every(s => s !== '' && s !== '.' && s !== '..')
}
