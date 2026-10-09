// src/lib/guestFileRestore/walk.ts
//
// Lists a directory of the source the way the explorers do (PVE
// `file-restore/list`, PBS `catalog`) and walks a tree depth first. The
// agent method uses it to know the size of a selection before moving a
// byte (progress total, transfer cap) since its restores are staged one
// file at a time. Neither API reports modes or owners: only names, types,
// sizes and mtimes.

import { pbsFetch } from '@/lib/proxmox/pbs-client'
import { pveFetch } from '@/lib/proxmox/client'

import { stripTrailing } from './paths'
import type { ResolvedSource } from './sources'

export type SourceEntryType = 'file' | 'directory' | 'symlink' | 'other'

export interface SourceTreeEntry {
  /** Same convention as an item path: full file-restore path (pve) or archive-relative path (pbs). */
  path: string
  name: string
  type: SourceEntryType
  size: number
  mtime?: Date
}

export interface WalkOptions {
  /** Stop with an error past this many entries, so a huge tree cannot keep the job walking forever. */
  maxEntries?: number
}

export const DEFAULT_WALK_MAX_ENTRIES = 200_000

/** Indirection so tests can fake the APIs. */
export const _impl = { pveFetch, pbsFetch }

function base64(s: string): string {
  return Buffer.from(s, 'utf-8').toString('base64')
}

function joinSourcePath(dir: string, name: string): string {
  return `${stripTrailing(dir, '/')}/${name}`
}

function entryType(raw: { type?: string; leaf?: unknown }): SourceEntryType {
  switch (raw.type) {
    case 'd':
    case 'v':
      return 'directory'
    case 'f':
      return 'file'
    case 'l':
      return 'symlink'
    default:
      return raw.leaf === false ? 'directory' : 'other'
  }
}

function toEntry(dir: string, raw: any): SourceTreeEntry | null {
  const name = String(raw?.text ?? raw?.filename ?? raw?.name ?? '')
  // A name is one path segment: anything else cannot come from a listing.
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\0')) return null
  const mtime = typeof raw.mtime === 'number' && raw.mtime > 0 ? new Date(raw.mtime * 1000) : undefined
  const type = entryType(raw)
  return {
    path: joinSourcePath(dir, name),
    name,
    type,
    size: type === 'file' && typeof raw.size === 'number' && raw.size > 0 ? raw.size : 0,
    mtime,
  }
}

/** One level of the source, unsorted, unusable names dropped. */
export async function listSourceDirectory(src: ResolvedSource, dir: string, signal?: AbortSignal): Promise<SourceTreeEntry[]> {
  let raw: any[]
  if (src.kind === 'pve') {
    const params = new URLSearchParams({ volume: src.volumeId, filepath: base64(dir) })
    raw = await _impl.pveFetch<any[]>(
      src.conn,
      `/nodes/${encodeURIComponent(src.nodeName)}/storage/${encodeURIComponent(src.storage)}/file-restore/list?${params}`,
      { signal },
      { slowRead: true },
    )
  } else {
    const inner = dir === '/' ? '' : stripTrailing(dir, '/')
    const params = new URLSearchParams({
      'backup-type': src.backupType,
      'backup-id': src.backupId,
      'backup-time': String(src.backupTime),
      filepath: base64(`/${src.archive}${inner}`),
    })
    if (src.namespace) params.set('ns', src.namespace)
    raw = await _impl.pbsFetch<any[]>(src.conn, `/admin/datastore/${encodeURIComponent(src.datastore)}/catalog?${params}`, { signal })
  }
  const out: SourceTreeEntry[] = []
  for (const r of Array.isArray(raw) ? raw : []) {
    const e = toEntry(dir, r)
    if (e) out.push(e)
  }
  return out
}

/**
 * Depth-first walk under `dir`: a directory is yielded before its content,
 * entries of one level in name order so a restore is reproducible.
 */
export async function* walkSourceTree(src: ResolvedSource, dir: string, signal?: AbortSignal, opts: WalkOptions = {}): AsyncGenerator<SourceTreeEntry> {
  const max = opts.maxEntries ?? DEFAULT_WALK_MAX_ENTRIES
  let count = 0
  const stack: string[] = [dir]
  while (stack.length > 0) {
    if (signal?.aborted) throw new Error('Cancelled')
    const current = stack.pop()!
    const entries = (await listSourceDirectory(src, current, signal)).sort((a, b) => a.name.localeCompare(b.name))
    // Children are pushed in reverse so the next pop is the first name.
    const dirs: string[] = []
    for (const e of entries) {
      if (++count > max) throw new Error(`The selection has more than ${max} entries: restore it in smaller parts or over SSH`)
      yield e
      if (e.type === 'directory') dirs.push(e.path)
    }
    for (let i = dirs.length - 1; i >= 0; i--) stack.push(dirs[i])
  }
}
