// src/lib/guestFileRestore/spool.ts
//
// Disk staging for the guest agent method. The agent writes a few dozen KB
// per round trip, far slower than a backup is read, so one file at a time is
// first downloaded to a temp file and then pushed into the guest from disk.
// Before each file the free space of the spool disk is checked: a file that
// would eat into the configured margin is refused (the file fails, the job
// goes on). The SSH method never comes here, it streams.

import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, statfs, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/** Indirection so tests can fake the disk. */
export const _impl = { statfs, mkdir, unlink }

export const DEFAULT_SPOOL_SUBDIR = 'proxcenter-guest-restore'

/** Effective spool directory: the setting, or `<os tmp>/proxcenter-guest-restore`. */
export function resolveSpoolDir(setting: string): string {
  const trimmed = setting.trim()
  return trimmed ? trimmed : join(tmpdir(), DEFAULT_SPOOL_SUBDIR)
}

export class SpoolSpaceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SpoolSpaceError'
  }
}

/** Bytes the spool may still take: free space minus the margin to keep. */
export async function spoolBudget(dir: string, minFreeBytes: number): Promise<number> {
  await _impl.mkdir(dir, { recursive: true, mode: 0o700 })
  const st = await _impl.statfs(dir)
  const free = Number(st.bavail) * Number(st.bsize)
  return Math.max(0, free - minFreeBytes)
}

export interface SpooledFile {
  path: string
  size: number
  /** Delete the temp file (idempotent). */
  cleanup: () => Promise<void>
}

export interface SpoolOptions {
  dir: string
  minFreeBytes: number
  /** Expected size when known: refused up front when it does not fit. */
  size?: number
  /** Called with every chunk received from the source. */
  onBytes?: (n: number) => void
  signal?: AbortSignal
}

function describe(size: number | undefined, budget: number): string {
  const mib = (n: number) => `${Math.round(n / (1024 * 1024))} MiB`
  return size === undefined
    ? `only ${mib(budget)} available on the spool disk`
    : `${mib(size)} needed, ${mib(budget)} available on the spool disk`
}

/**
 * Write `body` to a fresh temp file under `dir`. The free space is checked
 * before the first byte and the write stops as soon as it would cross the
 * budget (a source that lied about its size, or one of unknown size).
 */
export async function spoolToFile(body: Readable, opts: SpoolOptions): Promise<SpooledFile> {
  const budget = await spoolBudget(opts.dir, opts.minFreeBytes)
  if (opts.size !== undefined && opts.size > budget) {
    throw new SpoolSpaceError(`Not enough space to stage the file: ${describe(opts.size, budget)}`)
  }

  const path = join(opts.dir, randomUUID())
  let size = 0
  let cleaned = false
  const cleanup = async () => {
    if (cleaned) return
    cleaned = true
    await _impl.unlink(path).catch(() => {})
  }

  const meter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      size += chunk.length
      if (size > budget) {
        cb(new SpoolSpaceError(`Not enough space to stage the file: ${describe(opts.size, budget)}`))
        return
      }
      opts.onBytes?.(chunk.length)
      cb(null, chunk)
    },
  })

  try {
    await pipeline(body, meter, createWriteStream(path, { mode: 0o600 }), { signal: opts.signal })
  } catch (err) {
    await cleanup()
    throw err
  }
  return { path, size, cleanup }
}
