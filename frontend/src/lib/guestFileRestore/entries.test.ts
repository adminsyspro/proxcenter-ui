import { PassThrough, Readable } from 'node:stream'

import { describe, expect, it, vi } from 'vitest'

import { ensureRootPrefix, normalizeTarName, readRestoreEntries, type RestoreEntry } from './entries'
import { buildTarZst, readAll, streamOf } from './fixtures.test-helpers'
import { SourceStallError, stallWatchdog } from './stream'

async function collect(body: Readable, item: { path: string; directory: boolean; size?: number }, skips: string[] = []) {
  const out: Array<RestoreEntry & { content?: string }> = []
  for await (const entry of readRestoreEntries(body, item, { onSkip: (reason, name) => skips.push(`${name}:${reason}`) })) {
    const content = entry.body ? (await readAll(entry.body)).toString() : undefined
    out.push({ ...entry, body: undefined, content })
  }
  return out
}

describe('normalizeTarName / ensureRootPrefix', () => {
  it('strips ./ and leading slashes, refuses climbing and backslashes', () => {
    expect(normalizeTarName('./apt/sources.list')).toBe('apt/sources.list')
    expect(normalizeTarName('/apt/x')).toBe('apt/x')
    expect(normalizeTarName('apt//x/')).toBe('apt/x')
    expect(normalizeTarName('apt/../etc/passwd')).toBeNull()
    expect(normalizeTarName('..')).toBeNull()
    expect(normalizeTarName('./')).toBeNull()
    expect(normalizeTarName('a\\b')).toBeNull()
  })
  it('prefixes entries that are relative to the directory itself', () => {
    expect(ensureRootPrefix('apt/x', 'apt')).toBe('apt/x')
    expect(ensureRootPrefix('apt', 'apt')).toBe('apt')
    expect(ensureRootPrefix('x', 'apt')).toBe('apt/x')
  })
})

describe('readRestoreEntries', () => {
  it('yields a single raw entry for a file item', async () => {
    const entries = await collect(streamOf(Buffer.from('127.0.0.1 localhost\n')), { path: '/root.pxar.didx/etc/hosts', directory: false, size: 20 })
    expect(entries).toEqual([{ relPath: 'hosts', type: 'file', size: 20, body: undefined, content: '127.0.0.1 localhost\n' }])
  })

  it('decodes a tar.zst directory with metadata, in order, consuming each body', async () => {
    const mtime = new Date('2026-07-14T21:33:00Z')
    const archive = await buildTarZst([
      { name: 'apt', type: 'directory', mode: 0o755, uid: 0, gid: 0, mtime },
      { name: 'apt/sources.list', content: 'deb http://deb.debian.org/debian trixie main\n', mode: 0o644, uid: 0, gid: 0, mtime },
      { name: 'apt/apt.conf.d', type: 'directory', mode: 0o755, mtime },
      { name: 'apt/apt.conf.d/01autoremove', content: 'APT::NeverAutoRemove { };\n', mode: 0o600, uid: 1000, gid: 1000, mtime },
      { name: 'apt/big.bin', content: Buffer.alloc(70_000, 7), mode: 0o644, mtime },
      { name: 'apt/link', type: 'symlink', linkname: 'sources.list', mtime },
    ])
    const skips: string[] = []
    const entries = await collect(streamOf(archive, 512), { path: '/drive-scsi0.img.fidx/part/1/etc/apt', directory: true }, skips)

    expect(skips).toEqual([])
    expect(entries.map(e => [e.relPath, e.type])).toEqual([
      ['apt', 'directory'],
      ['apt/sources.list', 'file'],
      ['apt/apt.conf.d', 'directory'],
      ['apt/apt.conf.d/01autoremove', 'file'],
      ['apt/big.bin', 'file'],
      ['apt/link', 'symlink'],
    ])
    expect(entries[1]).toMatchObject({ size: 45, mode: 0o644, uid: 0, gid: 0, content: 'deb http://deb.debian.org/debian trixie main\n' })
    expect(entries[1].mtime?.getTime()).toBe(mtime.getTime())
    expect(entries[3]).toMatchObject({ mode: 0o600, uid: 1000, gid: 1000 })
    expect(entries[4].content).toHaveLength(70_000)
    expect(entries[5]).toMatchObject({ linkTarget: 'sources.list' })
  })

  it('skips hardlinks, devices and unsafe names, and keeps going', async () => {
    const archive = await buildTarZst([
      { name: 'apt', type: 'directory' },
      { name: 'apt/a', content: 'a' },
      { name: 'apt/hard', type: 'link', linkname: 'apt/a' },
      { name: '../../etc/passwd', content: 'evil' },
      { name: 'apt/b', content: 'b' },
    ])
    const skips: string[] = []
    const entries = await collect(streamOf(archive), { path: '/root.pxar.didx/etc/apt', directory: true }, skips)
    expect(entries.map(e => e.relPath)).toEqual(['apt', 'apt/a', 'apt/b'])
    expect(skips).toEqual(['apt/hard:hardlink', '../../etc/passwd:unsafe name'])
  })

  it('moves on when the consumer does not read a body', async () => {
    const archive = await buildTarZst([
      { name: 'd/one', content: 'x'.repeat(5000) },
      { name: 'd/two', content: 'two' },
    ])
    const seen: string[] = []
    for await (const entry of readRestoreEntries(streamOf(archive), { path: '/root.pxar.didx/d', directory: true })) {
      seen.push(entry.relPath)
    }
    expect(seen).toEqual(['d/one', 'd/two'])
  })

  it('normalises entries that are relative to the directory itself', async () => {
    const archive = await buildTarZst([{ name: './x.conf', content: '1' }])
    const entries = await collect(streamOf(archive), { path: '/root.pxar.didx/etc/apt', directory: true })
    expect(entries.map(e => e.relPath)).toEqual(['apt/x.conf'])
  })

  it('surfaces a corrupt archive as an error', async () => {
    const body = streamOf(Buffer.from('this is not zstd at all'))
    await expect(collect(body, { path: '/root.pxar.didx/etc/apt', directory: true })).rejects.toThrow()
  })
})

describe('readRestoreEntries with an explicit tar flag', () => {
  it('decodes a single file asked as tar (PVE tar=1) with its metadata', async () => {
    const tar = await buildTarZst([{ name: 'hosts', content: 'x\n', mode: 0o600, uid: 7, gid: 8, mtime: new Date(1_700_000_000_000) }])
    const out: RestoreEntry[] = []
    for await (const entry of readRestoreEntries(streamOf(tar, 100), { path: '/drive-scsi0.img.fidx/part/1/etc/hosts', directory: false }, { tar: true })) {
      out.push({ ...entry, body: entry.body ? ((await readAll(entry.body)).toString() as any) : undefined })
    }
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ relPath: 'hosts', type: 'file', size: 2, mode: 0o600, uid: 7, gid: 8, body: 'x\n' })
    expect(out[0].mtime?.getTime()).toBe(1_700_000_000_000)
  })

  it('treats a directory item as raw when told so', async () => {
    const out: RestoreEntry[] = []
    for await (const entry of readRestoreEntries(Readable.from([Buffer.from('raw')]), { path: '/etc/apt', directory: true, size: 3 }, { tar: false })) {
      out.push(entry)
    }
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ relPath: 'apt', type: 'file', size: 3 })
  })
})

describe('readRestoreEntries robustness', () => {
  it('takes the long name from a PAX header', async () => {
    const long = 'd/' + 'n'.repeat(140) + '/file.txt'
    const archive = await buildTarZst([{ name: long, content: 'x' }])
    const entries = await collect(streamOf(archive), { path: '/root.pxar.didx/d', directory: true })
    expect(entries.map(e => e.relPath)).toEqual([long])
    expect(entries[0].content).toBe('x')
  })

  it('rejects the body being read when the download dies mid-entry, instead of hanging', async () => {
    const archive = await buildTarZst([{ name: 'd/big', content: Buffer.alloc(200_000, 1) }, { name: 'd/after', content: 'a' }])
    const cut = archive.subarray(0, Math.floor(archive.length / 2))
    const source = new PassThrough()
    const run = (async () => {
      const seen: string[] = []
      for await (const entry of readRestoreEntries(source, { path: '/root.pxar.didx/d', directory: true })) {
        seen.push(entry.relPath)
        if (entry.body) await readAll(entry.body)
      }
      return seen
    })()
    source.write(cut)
    setTimeout(() => source.destroy(new Error('other side closed')), 20)
    await expect(Promise.race([run, new Promise((_, reject) => setTimeout(() => reject(new Error('hung')), 2000))])).rejects.toThrow('other side closed')
  })

  it('fails through the stall watchdog when the source stops sending', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const archive = await buildTarZst([{ name: 'd/big', content: Buffer.alloc(100_000, 2) }])
      const source = new PassThrough()
      const watchdog = stallWatchdog(1_000)
      source.pipe(watchdog)
      const run = (async () => {
        for await (const entry of readRestoreEntries(watchdog, { path: '/root.pxar.didx/d', directory: true })) {
          if (entry.body) await readAll(entry.body)
        }
      })()
      run.catch(() => {})
      source.write(archive.subarray(0, 4000))
      await new Promise(r => setImmediate(r))
      await vi.advanceTimersByTimeAsync(1_100)
      await expect(run).rejects.toBeInstanceOf(SourceStallError)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('readRestoreEntries under backpressure', () => {
  it('streams a large entry from a paced source to a for-await consumer without stalling', async () => {
    // The archive arrives in small pieces on timers, like a socket; the
    // consumer reads one chunk per tick. Lab, 2026-10-09: this froze.
    const content = Buffer.alloc(3 * 1024 * 1024)
    for (let i = 0; i < content.length; i += 4096) content.writeUInt32LE(i, i)
    const archive = await buildTarZst([{ name: 'd/big.bin', content }, { name: 'd/after', content: 'z' }])
    const source = new PassThrough()
    let off = 0
    const feed = () => {
      if (off >= archive.length) { source.end(); return }
      source.write(archive.subarray(off, off + 16 * 1024))
      off += 16 * 1024
      setTimeout(feed, 1)
    }
    setTimeout(feed, 1)
    const run = (async () => {
      const out: Array<[string, number]> = []
      for await (const entry of readRestoreEntries(source, { path: '/root.pxar.didx/d', directory: true })) {
        let n = 0
        if (entry.body) for await (const c of entry.body) { n += c.length; await new Promise(r => setImmediate(r)) }
        out.push([entry.relPath, n])
      }
      return out
    })()
    const result = await Promise.race([run, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('stalled')), 20_000))])
    expect(result).toEqual([['d/big.bin', content.length], ['d/after', 1]])
  }, 30_000)
})
