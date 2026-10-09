// Hand-built tar archives: the typeflags and header encodings tar-stream never
// produces (PAX, GNU long names, base-256 numbers, devices, truncation).

import { PassThrough, type Readable } from 'node:stream'
import { zstdCompressSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import { parsePax, parseTarHeader, readRestoreEntries, TAR_BLOCK, TarFormatError, type RestoreEntry } from './entries'
import { readAll, streamOf } from './fixtures.test-helpers'

interface RawHeader {
  name?: string
  typeflag?: string
  size?: number
  mode?: number
  uid?: number
  gid?: number
  mtime?: number
  linkname?: string
  prefix?: string
  ustar?: boolean
  /** Raw bytes written at an offset, after the numeric fields (before the checksum). */
  patch?: Array<[number, Buffer]>
  badChecksum?: boolean
}

function octal(block: Buffer, off: number, len: number, value: number | undefined) {
  if (value === undefined) return
  block.write(value.toString(8).padStart(len - 1, '0') + '\0', off, len, 'latin1')
}

function header(h: RawHeader): Buffer {
  const block = Buffer.alloc(TAR_BLOCK)
  block.write(h.name ?? '', 0, 100, 'utf8')
  octal(block, 100, 8, h.mode ?? 0o644)
  octal(block, 108, 8, h.uid ?? 0)
  octal(block, 116, 8, h.gid ?? 0)
  octal(block, 124, 12, h.size ?? 0)
  octal(block, 136, 12, h.mtime ?? 1_700_000_000)
  if (h.typeflag !== undefined) block.write(h.typeflag, 156, 1, 'latin1')
  block.write(h.linkname ?? '', 157, 100, 'utf8')
  if (h.ustar !== false) block.write('ustar\u000000', 257, 8, 'latin1')
  if (h.prefix) block.write(h.prefix, 345, 155, 'utf8')
  for (const [off, bytes] of h.patch ?? []) bytes.copy(block, off)
  block.fill(0x20, 148, 156)
  let sum = 0
  for (const b of block) sum += b
  block.write((h.badChecksum ? sum + 1 : sum).toString(8).padStart(6, '0') + '\0 ', 148, 8, 'latin1')
  return block
}

function data(content: Buffer | string): Buffer {
  const buf = typeof content === 'string' ? Buffer.from(content) : content
  const pad = (TAR_BLOCK - (buf.length % TAR_BLOCK)) % TAR_BLOCK
  return Buffer.concat([buf, Buffer.alloc(pad)])
}

function entry(h: RawHeader, content: Buffer | string = Buffer.alloc(0)): Buffer {
  const buf = typeof content === 'string' ? Buffer.from(content) : content
  return Buffer.concat([header({ size: buf.length, ...h }), data(buf)])
}

function pax(records: Record<string, string>): Buffer {
  const parts = Object.entries(records).map(([k, v]) => {
    const body = ` ${k}=${v}\n`
    let len = body.length + 1
    while (String(len).length + body.length !== len) len = String(len).length + body.length
    return `${len}${body}`
  })
  return Buffer.from(parts.join(''))
}

const END = Buffer.alloc(TAR_BLOCK * 2)
const zst = (...parts: Buffer[]) => zstdCompressSync(Buffer.concat(parts))

async function collect(body: Readable, path = '/root.pxar.didx/d') {
  const skips: string[] = []
  const out: Array<Omit<RestoreEntry, 'body'> & { content?: string }> = []
  for await (const e of readRestoreEntries(body, { path, directory: true }, { onSkip: (reason, name) => skips.push(`${name}:${reason}`) })) {
    const { body: b, ...rest } = e
    out.push({ ...rest, content: b ? (await readAll(b)).toString() : undefined })
  }
  return { out, skips }
}

describe('parseTarHeader', () => {
  it('refuses a short block and a bad checksum, and ends on a zero block', () => {
    expect(() => parseTarHeader(Buffer.alloc(100))).toThrow('Short tar header')
    expect(parseTarHeader(Buffer.alloc(TAR_BLOCK))).toBeNull()
    expect(() => parseTarHeader(header({ name: 'x', badChecksum: true }))).toThrow('Invalid tar header checksum')
  })

  it('joins the ustar prefix, defaults a NUL typeflag to a file and reads GNU base-256 numbers', () => {
    const big = Buffer.alloc(12)
    big[0] = 0x80
    big.writeUInt32BE(5_000_000_000 % 2 ** 32, 8)
    big[7] = Math.floor(5_000_000_000 / 2 ** 32)
    const h = parseTarHeader(header({ name: 'file', prefix: 'deep/dir', patch: [[124, big]] }))!
    expect(h).toMatchObject({ name: 'deep/dir/file', typeflag: '0', size: 5_000_000_000 })
  })

  it('ignores the prefix without the ustar magic, reads empty numbers as 0 and no mtime as undefined', () => {
    const h = parseTarHeader(header({ name: 'f', prefix: 'ignored', ustar: false, patch: [[108, Buffer.alloc(8)], [136, Buffer.alloc(12)]] }))!
    expect(h).toMatchObject({ name: 'f', uid: 0, mtime: undefined })
  })

  it('refuses a non-octal numeric field', () => {
    expect(() => parseTarHeader(header({ name: 'f', patch: [[100, Buffer.from('zzzz\0')]] }))).toThrow(TarFormatError)
  })
})

describe('parsePax', () => {
  it('reads records and stops on malformed input', () => {
    expect(parsePax(pax({ path: 'a/b', mtime: '12.5' }))).toEqual({ path: 'a/b', mtime: '12.5' })
    expect(parsePax(Buffer.from('nospace'))).toEqual({})
    expect(parsePax(Buffer.from('x path=a\n'))).toEqual({})
    expect(parsePax(Buffer.from('99 path=a\n'))).toEqual({})
    // A record without `=` is ignored, the next one still read.
    expect(parsePax(Buffer.from('7 noeq\n9 k=vvvv\n'))).toEqual({ k: 'vvvv' })
  })
})

describe('readRestoreEntries over hand-built archives', () => {
  it('applies PAX and GNU long-name overrides, and skips what it cannot restore', async () => {
    const longName = 'd/' + 'x'.repeat(150)
    const archive = zst(
      entry({ name: 'd', typeflag: '5', mode: 0o755 }),
      entry({ name: 'PaxHeader', typeflag: 'x' }, pax({ path: 'd/renamed', size: '3', mtime: '1700000100', uid: '42', gid: '43', linkpath: 'unused' })),
      entry({ name: 'd/short', typeflag: '0', size: 3 }, 'abc').subarray(0),
      entry({ name: 'PaxHeader', typeflag: 'x' }, pax({ size: 'NaN', uid: '-1', gid: 'x', mtime: 'later' })),
      entry({ name: 'd/kept', typeflag: '7', uid: 5 }, 'contig'),
      entry({ name: 'GlobalHead', typeflag: 'g' }, pax({ comment: 'ignored' })),
      entry({ name: '././@LongLink', typeflag: 'L' }, longName + '\0'),
      entry({ name: 'trunc', typeflag: '0' }, 'long'),
      entry({ name: '././@LongLink', typeflag: 'K' }, 'target/of/link'),
      entry({ name: 'd/link', typeflag: '2', linkname: 'short' }),
      entry({ name: 'PaxHeader', typeflag: 'x' }, pax({ linkpath: 'pax-target' })),
      entry({ name: 'd/link2', typeflag: '2', linkname: 'short' }),
      entry({ name: 'd/chr', typeflag: '3' }),
      entry({ name: 'd/blk', typeflag: '4' }),
      entry({ name: 'd/fifo', typeflag: '6' }),
      entry({ name: 'd/weird', typeflag: 'Z' }, 'zz'),
      entry({ name: 'd/hard', typeflag: '1', linkname: 'd/kept' }),
      entry({ name: 'a\\b', typeflag: '0' }, 'evil'),
      END,
    )
    const { out, skips } = await collect(streamOf(archive, 300))
    expect(out.map(e => [e.relPath, e.type, e.content])).toEqual([
      ['d', 'directory', undefined],
      ['d/renamed', 'file', 'abc'],
      ['d/kept', 'file', 'contig'],
      [longName, 'file', 'long'],
      ['d/link', 'symlink', undefined],
      ['d/link2', 'symlink', undefined],
    ])
    expect(out[1]).toMatchObject({ uid: 42, gid: 43, size: 3 })
    expect(out[1].mtime?.getTime()).toBe(1_700_000_100_000)
    expect(out[2]).toMatchObject({ uid: 5, size: 6 })
    expect(out[4].linkTarget).toBe('target/of/link')
    expect(out[5].linkTarget).toBe('pax-target')
    expect(skips).toEqual(['d/chr:device', 'd/blk:device', 'd/fifo:fifo', 'd/weird:unknown type Z', 'd/hard:hardlink', 'a\\b:unsafe name'])
  })

  it('stops cleanly at the end of the stream without end-of-archive blocks', async () => {
    const { out } = await collect(streamOf(zst(entry({ name: 'd/f' }, 'x'))))
    expect(out.map(e => e.relPath)).toEqual(['d/f'])
  })

  it('fails on a truncated header', async () => {
    await expect(collect(streamOf(zst(entry({ name: 'd/f' }, 'x'), Buffer.alloc(100, 1))))).rejects.toThrow('Archive truncated: 100 of 512 bytes')
  })

  it('fails when a skipped entry is cut short', async () => {
    const full = Buffer.concat([header({ name: 'd/dev', typeflag: '6', size: 4096 }), Buffer.alloc(100)])
    await expect(collect(streamOf(zst(full)))).rejects.toThrow('bytes missing')
  })

  it('fails the body of a file cut short', async () => {
    const archive = zst(header({ name: 'd/f', size: 2000 }), Buffer.alloc(700, 1))
    await expect(collect(streamOf(archive))).rejects.toThrow('Archive truncated: 700 of 2000 bytes')
  })

  it('holds the decoded data while the consumer applies backpressure, then delivers all of it', async () => {
    const content = Buffer.alloc(1024 * 1024, 3)
    const archive = zst(entry({ name: 'd/big' }, content), entry({ name: 'd/next' }, 'n'), END)
    const seen: Array<[string, number]> = []
    for await (const e of readRestoreEntries(streamOf(archive, 64 * 1024), { path: '/x/d', directory: true })) {
      if (!e.body) continue
      // Let the pull loop fill the buffer and stop on a refused push.
      for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r))
      seen.push([e.relPath, (await readAll(e.body)).length])
    }
    expect(seen).toEqual([['d/big', content.length], ['d/next', 1]])
  })

  it('moves past an entry the consumer destroyed while it was being pushed', async () => {
    const archive = zst(entry({ name: 'd/big' }, Buffer.alloc(600 * 1024, 4)), entry({ name: 'd/next' }, 'n'), END)
    const seen: string[] = []
    for await (const e of readRestoreEntries(streamOf(archive, 32 * 1024), { path: '/x/d', directory: true })) {
      seen.push(e.relPath)
      if (e.relPath === 'd/big') {
        const b = e.body!
        b.on('error', () => {})
        await new Promise<void>(resolve => {
          b.on('data', () => { b.destroy(); resolve() })
        })
      } else {
        await readAll(e.body!)
      }
    }
    expect(seen).toEqual(['d/big', 'd/next'])
  })

  it('tears the download down when the consumer leaves early', async () => {
    const source = new PassThrough()
    source.end(zst(entry({ name: 'd/a' }, 'a'), entry({ name: 'd/b' }, 'b'), END))
    for await (const e of readRestoreEntries(source, { path: '/x/d', directory: true })) {
      expect(e.relPath).toBe('d/a')
      break
    }
    expect(source.destroyed).toBe(true)
  })
})
