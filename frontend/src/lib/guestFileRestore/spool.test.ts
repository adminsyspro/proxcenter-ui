import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SpoolSpaceError, _impl, resolveSpoolDir, spoolBudget, spoolToFile } from './spool'

const MIB = 1024 * 1024

let dir: string

/** Pretend the spool disk has `freeBytes` available. */
function fakeFree(freeBytes: number) {
  vi.spyOn(_impl, 'statfs').mockResolvedValue({ bavail: BigInt(freeBytes / 4096), bsize: BigInt(4096) } as any)
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pxc-spool-test-'))
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(dir, { recursive: true, force: true })
})

describe('resolveSpoolDir', () => {
  it('falls back to the system temp dir when the setting is empty', () => {
    expect(resolveSpoolDir('')).toBe(join(tmpdir(), 'proxcenter-guest-restore'))
    expect(resolveSpoolDir('   ')).toBe(join(tmpdir(), 'proxcenter-guest-restore'))
    expect(resolveSpoolDir('/var/spool/pxc ')).toBe('/var/spool/pxc')
  })
})

describe('spoolBudget', () => {
  it('is the free space minus the margin, never negative', async () => {
    fakeFree(10 * MIB)
    expect(await spoolBudget(dir, 2 * MIB)).toBe(8 * MIB)
    expect(await spoolBudget(dir, 20 * MIB)).toBe(0)
  })
})

describe('spoolToFile', () => {
  it('stages the body in a private file and reports the bytes', async () => {
    fakeFree(10 * MIB)
    const seen: number[] = []
    const spooled = await spoolToFile(Readable.from([Buffer.from('abc'), Buffer.from('def')]), {
      dir,
      minFreeBytes: MIB,
      size: 6,
      onBytes: n => seen.push(n),
    })
    expect(spooled.size).toBe(6)
    expect(seen).toEqual([3, 3])
    expect((await readFile(spooled.path)).toString()).toBe('abcdef')
    expect(((await stat(spooled.path)).mode & 0o777)).toBe(0o600)
    await spooled.cleanup()
    await spooled.cleanup()
    expect(await readdir(dir)).toEqual([])
  })

  it('refuses a file larger than the free space before reading a byte', async () => {
    fakeFree(3 * MIB)
    let read = false
    const body = new Readable({ read() { read = true; this.push(null) } })
    await expect(spoolToFile(body, { dir, minFreeBytes: 2 * MIB, size: 2 * MIB })).rejects.toBeInstanceOf(SpoolSpaceError)
    await expect(spoolToFile(body, { dir, minFreeBytes: 2 * MIB, size: 2 * MIB })).rejects.toThrow('2 MiB needed, 1 MiB available')
    expect(read).toBe(false)
    expect(await readdir(dir)).toEqual([])
  })

  it('stops and removes the file when an unknown size crosses the budget', async () => {
    fakeFree(3 * MIB)
    const body = Readable.from([Buffer.alloc(MIB / 2), Buffer.alloc(MIB / 2), Buffer.alloc(MIB / 2)])
    await expect(spoolToFile(body, { dir, minFreeBytes: 2 * MIB })).rejects.toBeInstanceOf(SpoolSpaceError)
    expect(await readdir(dir)).toEqual([])
  })
})
