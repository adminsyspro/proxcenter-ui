// src/lib/guestFileRestore/entries.ts
//
// Turns a file-restore download into a stream of entries to write in the
// guest. A raw download is one entry; a tar.zst download (a directory, or a
// single file asked with tar=1 from PVE; verified on PVE 9.2 / PBS 4.2:
// entries are named `<basename>/...`, no leading `./`) is decoded on the
// fly, one entry at a time.
//
// The tar is parsed here, pull style: the zstd output is consumed with its
// async iterator and each entry body is a Readable that pulls exactly the
// entry's bytes on demand. Nothing pushes ahead of the consumer, and an
// upstream failure (download cut, stall watchdog, cancel) rejects the pull
// the consumer is waiting on instead of leaving it hanging (the push
// parser used before could stall forever when its source was destroyed).

import { Readable, pipeline } from 'node:stream'
import { createZstdDecompress } from 'node:zlib'

import { posixBasename } from './paths'
import type { GuestRestoreItem } from './types'

export interface RestoreEntry {
  /** Path relative to the parent of the item, posix separators, always starts with the item basename. */
  relPath: string
  type: 'file' | 'directory' | 'symlink'
  /** Unknown for a raw file download. */
  size?: number
  mode?: number
  uid?: number
  gid?: number
  mtime?: Date
  linkTarget?: string
  /** Only for files; must be consumed before the next entry is requested. */
  body?: Readable
}

export interface ReadEntriesOptions {
  /** Called for every tar entry that is not restored (hardlink, device, unsafe name). */
  onSkip?: (reason: string, name: string) => void
  /** Whether the body is tar.zst; defaults to `item.directory`. */
  tar?: boolean
}

/**
 * Normalise a tar header name: strip `./` and leading slashes, drop empty and
 * `.` segments, refuse anything that climbs (`..`) or carries a backslash.
 * Returns null when the name is unusable.
 */
export function normalizeTarName(name: string): string | null {
  if (name.includes('\\') || name.includes('\0')) return null
  const segs = name.split('/').filter(s => s !== '' && s !== '.')
  if (segs.length === 0) return null
  if (segs.some(s => s === '..')) return null
  return segs.join('/')
}

/** Make sure a relative path starts with the directory the item names. */
export function ensureRootPrefix(rel: string, rootName: string): string {
  if (rel === rootName || rel.startsWith(rootName + '/')) return rel
  return `${rootName}/${rel}`
}

// ---- byte reader over the decompressed stream -------------------------------

export class TarFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TarFormatError'
  }
}

/** Pull bytes from an async iterable of buffers, with an internal remainder. */
class ByteReader {
  private readonly it: AsyncIterator<Buffer>
  private pending: Buffer | null = null
  private ended = false

  constructor(source: AsyncIterable<Buffer>) {
    this.it = source[Symbol.asyncIterator]()
  }

  /** Up to `max` bytes, or null at the end of the stream. */
  async read(max: number): Promise<Buffer | null> {
    if (!this.pending) {
      if (this.ended) return null
      const { value, done } = await this.it.next()
      if (done) {
        this.ended = true
        return null
      }
      this.pending = Buffer.isBuffer(value) ? value : Buffer.from(value)
      if (this.pending.length === 0) {
        this.pending = null
        return this.read(max)
      }
    }
    const buf = this.pending
    if (buf.length <= max) {
      this.pending = null
      return buf
    }
    this.pending = buf.subarray(max)
    return buf.subarray(0, max)
  }

  /** Exactly `n` bytes; null at a clean end before the first byte; throws on a short read. */
  async readExact(n: number): Promise<Buffer | null> {
    const parts: Buffer[] = []
    let got = 0
    while (got < n) {
      const chunk = await this.read(n - got)
      if (!chunk) {
        if (got === 0) return null
        throw new TarFormatError(`Archive truncated: ${got} of ${n} bytes`)
      }
      parts.push(chunk)
      got += chunk.length
    }
    return parts.length === 1 ? parts[0] : Buffer.concat(parts, n)
  }

  async skip(n: number): Promise<void> {
    let left = n
    while (left > 0) {
      const chunk = await this.read(left)
      if (!chunk) throw new TarFormatError(`Archive truncated: ${left} bytes missing`)
      left -= chunk.length
    }
  }

  /** Stop pulling: the iterator is told to clean up (a destroyed source rejects the pending pull anyway). */
  async close(): Promise<void> {
    this.ended = true
    this.pending = null
    await this.it.return?.().catch(() => {})
  }
}

// ---- tar header parsing ----------------------------------------------------

export const TAR_BLOCK = 512

interface TarHeader {
  name: string
  mode: number
  uid: number
  gid: number
  size: number
  mtime: Date | undefined
  typeflag: string
  linkname: string
}

function cstr(buf: Buffer, off: number, len: number): string {
  const slice = buf.subarray(off, off + len)
  const nul = slice.indexOf(0)
  return (nul === -1 ? slice : slice.subarray(0, nul)).toString('utf8')
}

/** Octal field, or GNU base-256 when the high bit of the first byte is set. */
function numeric(buf: Buffer, off: number, len: number): number {
  const field = buf.subarray(off, off + len)
  if (field.length > 0 && (field[0] & 0x80) !== 0) {
    let value = 0
    for (let i = 0; i < field.length; i++) value = value * 256 + (i === 0 ? field[i] & 0x7f : field[i])
    return value
  }
  const text = cstr(field, 0, field.length).trim()
  if (text === '') return 0
  const value = Number.parseInt(text, 8)
  if (!Number.isFinite(value)) throw new TarFormatError(`Invalid numeric field "${text}"`)
  return value
}

function checksum(block: Buffer): number {
  let sum = 0
  for (let i = 0; i < TAR_BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : block[i]
  return sum
}

/** Parse one 512-byte header block; null for an all-zero (end of archive) block. */
export function parseTarHeader(block: Buffer): TarHeader | null {
  if (block.length !== TAR_BLOCK) throw new TarFormatError('Short tar header')
  if (block.every(b => b === 0)) return null
  const recorded = numeric(block, 148, 8)
  if (recorded !== checksum(block)) throw new TarFormatError('Invalid tar header checksum')
  const magic = block.subarray(257, 263).toString('latin1')
  let name = cstr(block, 0, 100)
  const prefix = magic.startsWith('ustar') ? cstr(block, 345, 155) : ''
  if (prefix) name = `${prefix}/${name}`
  const typeflag = block[156] === 0 ? '0' : String.fromCodePoint(block[156])
  const mtime = numeric(block, 136, 12)
  return {
    name,
    mode: numeric(block, 100, 8) & 0o7777,
    uid: numeric(block, 108, 8),
    gid: numeric(block, 116, 8),
    size: numeric(block, 124, 12),
    mtime: mtime > 0 ? new Date(mtime * 1000) : undefined,
    typeflag,
    linkname: cstr(block, 157, 100),
  }
}

/** PAX extended header records: `<len> <key>=<value>\n`. */
export function parsePax(body: Buffer): Record<string, string> {
  const out: Record<string, string> = {}
  let off = 0
  while (off < body.length) {
    const space = body.indexOf(0x20, off)
    if (space === -1) break
    const len = Number.parseInt(body.subarray(off, space).toString('latin1'), 10)
    if (!Number.isFinite(len) || len <= 0 || off + len > body.length) break
    const record = body.subarray(space + 1, off + len - 1).toString('utf8')
    const eq = record.indexOf('=')
    if (eq > 0) out[record.slice(0, eq)] = record.slice(eq + 1)
    off += len
  }
  return out
}

/** Overrides from a PAX or GNU long-name entry that apply to the next entry. */
interface PendingMeta {
  path?: string
  linkpath?: string
  size?: number
  mtime?: Date
  uid?: number
  gid?: number
}

function padding(size: number): number {
  return (TAR_BLOCK - (size % TAR_BLOCK)) % TAR_BLOCK
}

/**
 * Readable serving exactly `size` bytes pulled from the reader. The parser
 * waits for `settled()` before it reads past the entry, so a consumer that
 * stopped early never races with the skip of what it left.
 */
class EntryBody extends Readable {
  delivered = 0
  private pulling: Promise<void> | null = null
  private stopped = false

  constructor(private readonly reader: ByteReader, readonly size: number) {
    super({ highWaterMark: 256 * 1024 })
  }

  _read(): void {
    if (this.pulling !== null || this.stopped) return
    this.pulling = this.pull()
  }

  /**
   * One pull loop at a time: it runs until the consumer's buffer is full or
   * the entry ends. `pulling` is cleared synchronously at every exit: Node
   * calls `_read` from the `readable` tick that follows a refused push, and
   * a `_read` that finds the loop still marked as running returns without
   * pushing, after which the stream never asks again (lab, 2026-10-09: a
   * 2 GiB restore froze at 2 MiB).
   */
  private async pull(): Promise<void> {
    try {
      while (!this.stopped) {
        const left = this.size - this.delivered
        if (left <= 0) {
          this.stopped = true
          this.pulling = null
          this.push(null)
          return
        }
        const chunk = await this.reader.read(left)
        if (this.stopped) {
          this.pulling = null
          return
        }
        if (!chunk) {
          this.stopped = true
          this.pulling = null
          this.destroy(new TarFormatError(`Archive truncated: ${this.delivered} of ${this.size} bytes`))
          return
        }
        this.delivered += chunk.length
        const more = this.delivered < this.size
        const wanted = this.push(chunk)
        if (!more) {
          this.stopped = true
          this.pulling = null
          this.push(null)
          return
        }
        if (!wanted) {
          this.pulling = null
          return
        }
      }
      this.pulling = null
    } catch (err) {
      this.stopped = true
      this.pulling = null
      this.destroy(err instanceof Error ? err : new Error(String(err)))
    }
  }

  _destroy(err: Error | null, cb: (e?: Error | null) => void): void {
    this.stopped = true
    cb(err)
  }

  /** Resolves once no pull is in flight (the reader may then be used again). */
  async settled(): Promise<void> {
    this.stopped = true
    while (this.pulling !== null) await this.pulling.catch(() => {})
  }
}

export async function* readRestoreEntries(
  body: Readable,
  item: Pick<GuestRestoreItem, 'path' | 'directory' | 'size'>,
  opts: ReadEntriesOptions = {},
): AsyncGenerator<RestoreEntry> {
  const rootName = posixBasename(item.path)

  if (!(opts.tar ?? item.directory)) {
    yield { relPath: rootName, type: 'file', size: item.size, body }
    return
  }

  const zstd = createZstdDecompress()
  // pipeline (not pipe) so a destroyed download tears the decoder down and
  // the pull below rejects instead of waiting forever.
  pipeline(body, zstd, () => {})
  const reader = new ByteReader(zstd as AsyncIterable<Buffer>)
  let meta: PendingMeta = {}

  try {
    for (;;) {
      const block = await reader.readExact(TAR_BLOCK)
      if (!block) return
      const header = parseTarHeader(block)
      if (!header) return

      const size = meta.size ?? header.size
      const name = meta.path ?? header.name
      const linkname = meta.linkpath ?? header.linkname
      const common = {
        mode: header.mode,
        uid: meta.uid ?? header.uid,
        gid: meta.gid ?? header.gid,
        mtime: meta.mtime ?? header.mtime,
      }
      meta = {}

      switch (header.typeflag) {
        case 'x': {
          const pax = parsePax((await reader.readExact(size)) ?? Buffer.alloc(0))
          await reader.skip(padding(size))
          if (pax.path !== undefined) meta.path = pax.path
          if (pax.linkpath !== undefined) meta.linkpath = pax.linkpath
          if (pax.size !== undefined && /^\d+$/.test(pax.size)) meta.size = Number(pax.size)
          if (pax.mtime !== undefined && Number.isFinite(Number(pax.mtime))) meta.mtime = new Date(Number(pax.mtime) * 1000)
          if (pax.uid !== undefined && /^\d+$/.test(pax.uid)) meta.uid = Number(pax.uid)
          if (pax.gid !== undefined && /^\d+$/.test(pax.gid)) meta.gid = Number(pax.gid)
          continue
        }
        case 'L':
        case 'K': {
          const text = cstr((await reader.readExact(size)) ?? Buffer.alloc(0), 0, size)
          await reader.skip(padding(size))
          if (header.typeflag === 'L') meta.path = text
          else meta.linkpath = text
          continue
        }
        case 'g':
          // Global pax header: nothing we use.
          await reader.skip(size + padding(size))
          continue
        default:
          break
      }

      const rel = normalizeTarName(name)
      if (!rel) {
        opts.onSkip?.('unsafe name', name)
        await reader.skip(size + padding(size))
        continue
      }
      const relPath = ensureRootPrefix(rel, rootName)

      switch (header.typeflag) {
        case '0':
        case '7': {
          const entryBody = new EntryBody(reader, size)
          yield { relPath, type: 'file', size, body: entryBody, ...common }
          // The consumer may have stopped early: wait for its last pull, then
          // move past what it left.
          await entryBody.settled()
          if (!entryBody.destroyed) entryBody.destroy()
          await reader.skip(size - entryBody.delivered + padding(size))
          break
        }
        case '5':
          await reader.skip(size + padding(size))
          yield { relPath, type: 'directory', ...common }
          break
        case '2':
          await reader.skip(size + padding(size))
          yield { relPath, type: 'symlink', linkTarget: linkname, ...common }
          break
        case '1':
          opts.onSkip?.('hardlink', relPath)
          await reader.skip(size + padding(size))
          break
        case '3':
        case '4':
          opts.onSkip?.('device', relPath)
          await reader.skip(size + padding(size))
          break
        case '6':
          opts.onSkip?.('fifo', relPath)
          await reader.skip(size + padding(size))
          break
        default:
          opts.onSkip?.(`unknown type ${header.typeflag}`, relPath)
          await reader.skip(size + padding(size))
      }
    }
  } finally {
    // Leaving early (cancel, fatal writer error, corrupt archive): tear the
    // decoder and the download down so the socket does not linger.
    await reader.close()
    if (!zstd.destroyed) zstd.destroy()
    if (!body.destroyed) body.destroy()
  }
}
