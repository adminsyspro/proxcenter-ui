import { describe, it, expect } from 'vitest'
import {
  NfcProgressTracker,
  resolveNfcConcurrency,
  runWithConcurrency,
  NFC_CONCURRENCY_DEFAULT,
  NFC_CONCURRENCY_MAX,
  parseNfcConcurrency,
  serializeByKey,
} from './nfc-progress'

describe('parseNfcConcurrency', () => {
  it('accepts integers from 1 to 8, as numbers or numeric strings', () => {
    expect(parseNfcConcurrency(1)).toBe(1)
    expect(parseNfcConcurrency(8)).toBe(8)
    expect(parseNfcConcurrency('4')).toBe(4)
    expect(parseNfcConcurrency(' 3 ')).toBe(3)
  })

  it('returns null for anything the slider could not have produced', () => {
    for (const bad of [0, 9, -1, 2.5, '', 'many', '2.5', null, undefined, true, {}]) {
      expect(parseNfcConcurrency(bad)).toBeNull()
    }
  })
})

const GiB = 1073741824

describe('resolveNfcConcurrency', () => {
  it('defaults to 2 when the variable is unset or empty', () => {
    expect(NFC_CONCURRENCY_DEFAULT).toBe(2)
    expect(resolveNfcConcurrency(undefined)).toBe(2)
    expect(resolveNfcConcurrency('')).toBe(2)
  })

  it('accepts an integer inside the allowed range', () => {
    expect(resolveNfcConcurrency('4')).toBe(4)
    expect(resolveNfcConcurrency(' 1 ')).toBe(1)
  })

  it('clamps values above the ceiling to the ceiling', () => {
    expect(NFC_CONCURRENCY_MAX).toBe(8)
    expect(resolveNfcConcurrency('50')).toBe(8)
  })

  it('falls back to the default on garbage, zero or negative values', () => {
    expect(resolveNfcConcurrency('many')).toBe(2)
    expect(resolveNfcConcurrency('0')).toBe(2)
    expect(resolveNfcConcurrency('-3')).toBe(2)
    expect(resolveNfcConcurrency('2.5')).toBe(2)
  })

  it('accepts the number the migration dialog sends, clamped to the ceiling', () => {
    expect(resolveNfcConcurrency(3)).toBe(3)
    expect(resolveNfcConcurrency(1)).toBe(1)
    expect(resolveNfcConcurrency(50)).toBe(8)
    expect(resolveNfcConcurrency(0)).toBe(2)
    expect(resolveNfcConcurrency(2.5)).toBe(2)
    expect(resolveNfcConcurrency(null)).toBe(2)
    expect(resolveNfcConcurrency(Number.NaN)).toBe(2)
  })
})

describe('NfcProgressTracker', () => {
  it('maps a single disk position onto the offset/scale band', () => {
    const t = new NfcProgressTracker([100 * GiB], { offset: 0, scale: 50 })
    t.update(0, { positionBytes: 50 * GiB, wireBytes: 20 * GiB }, 1000)
    expect(t.diskPercent(0)).toBe(50)
    expect(t.globalPercent()).toBe(25)
  })

  it('weights disks by capacity, not by count', () => {
    // 10 GiB disk done, 90 GiB disk untouched: 10 percent of the data moved.
    const t = new NfcProgressTracker([10 * GiB, 90 * GiB], { offset: 0, scale: 100 })
    t.update(0, { positionBytes: 10 * GiB, wireBytes: 3 * GiB, done: true }, 1000)
    expect(t.globalPercent()).toBe(10)
  })

  it('holds a disk at 99 percent until it is marked done', () => {
    const t = new NfcProgressTracker([GiB], { offset: 0, scale: 100 })
    t.update(0, { positionBytes: GiB, wireBytes: GiB / 2 }, 1000)
    expect(t.diskPercent(0)).toBe(99)
    t.update(0, { positionBytes: GiB, wireBytes: GiB / 2, done: true }, 2000)
    expect(t.diskPercent(0)).toBe(100)
    expect(t.globalPercent()).toBe(100)
  })

  it('takes the capacity from a sample when the caller did not know it upfront', () => {
    const t = new NfcProgressTracker([0], { offset: 0, scale: 100 })
    expect(t.diskPercent(0)).toBeNull()
    t.update(0, { positionBytes: 25 * GiB, wireBytes: 5 * GiB, capacityBytes: 100 * GiB }, 1000)
    expect(t.diskPercent(0)).toBe(25)
    expect(t.summary().totalBytes).toBe(100 * GiB)
  })

  it('falls back to the wire/capacity ratio when the stream position is unknown', () => {
    const t = new NfcProgressTracker([100 * GiB], { offset: 0, scale: 100 })
    t.update(0, { positionBytes: null, wireBytes: 30 * GiB }, 1000)
    expect(t.diskPercent(0)).toBe(30)
  })

  it('never reports beyond the end of its band while a disk is still running', () => {
    const t = new NfcProgressTracker([GiB, GiB], { offset: 0, scale: 50 })
    t.update(0, { positionBytes: GiB, wireBytes: GiB, done: true }, 1000)
    t.update(1, { positionBytes: GiB, wireBytes: GiB }, 1000)
    expect(t.globalPercent()).toBeLessThan(50)
  })

  it('reports logical bytes moved, the logical rate and the wire rate over the recent window', () => {
    const t = new NfcProgressTracker([100 * GiB, 100 * GiB], { offset: 0, scale: 50 })
    t.update(0, { positionBytes: 0, wireBytes: 0 }, 0)
    t.update(1, { positionBytes: 0, wireBytes: 0 }, 0)
    // 60 s later: disk 0 advanced 3000 MB logically for 1500 MB on the wire,
    // disk 1 advanced 3000 MB for 1500 MB. 6000 MB / 60 s = 100 MB/s logical.
    t.update(0, { positionBytes: 3000 * 1048576, wireBytes: 1500 * 1048576 }, 60_000)
    t.update(1, { positionBytes: 3000 * 1048576, wireBytes: 1500 * 1048576 }, 60_000)
    const s = t.summary()
    expect(s.bytesTransferred).toBe(6000 * 1048576)
    expect(s.totalBytes).toBe(200 * GiB)
    expect(s.transferSpeed).toBe('100.0 MB/s (50.0 MB/s on the wire)')
    expect(s.wireMBps).toBeCloseTo(50, 1)
  })

  it('has no rate before the window holds at least ten seconds of samples', () => {
    const t = new NfcProgressTracker([GiB], { offset: 0, scale: 50 })
    t.update(0, { positionBytes: 0, wireBytes: 0 }, 0)
    t.update(0, { positionBytes: 100 * 1048576, wireBytes: 50 * 1048576 }, 5000)
    expect(t.summary().transferSpeed).toBeNull()
  })

  it('counts a finished disk as its full capacity in the bytes moved', () => {
    const t = new NfcProgressTracker([10 * GiB, 10 * GiB], { offset: 0, scale: 50 })
    t.update(0, { positionBytes: 10 * GiB, wireBytes: GiB, done: true }, 1000)
    expect(t.summary().bytesTransferred).toBe(10 * GiB)
  })
})

describe('runWithConcurrency', () => {
  const tick = () => new Promise<void>(r => setTimeout(r, 5))

  it('runs at most `limit` workers at once and returns results in index order', async () => {
    let running = 0
    let peak = 0
    const results = await runWithConcurrency(5, 2, async (i) => {
      running++
      peak = Math.max(peak, running)
      await tick()
      running--
      return i * 10
    })
    expect(results).toEqual([0, 10, 20, 30, 40])
    expect(peak).toBe(2)
  })

  it('runs everything when limit exceeds the item count', async () => {
    const results = await runWithConcurrency(2, 8, async (i) => i)
    expect(results).toEqual([0, 1])
  })

  it('rejects with the first error, raises the abort flag and starts nothing new', async () => {
    const started: number[] = []
    const seenAbort: boolean[] = []
    await expect(runWithConcurrency(4, 2, async (i, abort) => {
      started.push(i)
      if (i === 1) {
        await tick()
        throw new Error('disk 2 broke')
      }
      // A long-running sibling notices the flag on its next poll.
      for (let n = 0; n < 20 && !abort.aborted; n++) await tick()
      seenAbort.push(abort.aborted)
      return i
    })).rejects.toThrow('disk 2 broke')
    expect(started).toEqual([0, 1])
    expect(seenAbort).toEqual([true])
  })

  it('waits for in-flight workers to settle before rejecting', async () => {
    let settled = 0
    await expect(runWithConcurrency(2, 2, async (i) => {
      if (i === 0) throw new Error('boom')
      await tick()
      await tick()
      settled++
      return i
    })).rejects.toThrow('boom')
    expect(settled).toBe(1)
  })

  it('resolves to an empty list for zero items', async () => {
    expect(await runWithConcurrency(0, 2, async (i) => i)).toEqual([])
  })
})

describe('serializeByKey', () => {
  it('runs overlapping calls for the same key one after the other, in order', async () => {
    const events: string[] = []
    let release: () => void = () => {}
    const slow = serializeByKey(async (key: string, label: string) => {
      events.push(`start ${key} ${label}`)
      if (label === 'a') await new Promise<void>(r => { release = r })
      events.push(`end ${key} ${label}`)
    })
    const first = slow('job', 'a')
    const second = slow('job', 'b')
    await Promise.resolve()
    expect(events).toEqual(['start job a'])
    release()
    await Promise.all([first, second])
    expect(events).toEqual(['start job a', 'end job a', 'start job b', 'end job b'])
  })

  it('keeps serving a key after one call rejected', async () => {
    const seen: string[] = []
    const fn = serializeByKey(async (_key: string, label: string) => {
      if (label === 'bad') throw new Error('nope')
      seen.push(label)
    })
    await expect(fn('job', 'bad')).rejects.toThrow('nope')
    await fn('job', 'good')
    expect(seen).toEqual(['good'])
  })

  it('does not make different keys wait for each other', async () => {
    const events: string[] = []
    let release: () => void = () => {}
    const fn = serializeByKey(async (key: string) => {
      events.push(`start ${key}`)
      if (key === 'slow') await new Promise<void>(r => { release = r })
      events.push(`end ${key}`)
    })
    const slow = fn('slow')
    await fn('fast')
    expect(events).toEqual(['start slow', 'start fast', 'end fast'])
    release()
    await slow
  })
})
