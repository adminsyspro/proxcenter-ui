import { describe, it, expect } from 'vitest'

import { fwLine, loggerLine, pveFirewallLog } from '@/__tests__/setup/pveFirewallLog'

import { currentFileStart, memoReader, readLogWindow } from './logWindow'

import type { LogPageReader } from './logWindow'

// The current file opens at ROTATED (the logger restarts at each rotation),
// yesterday's file holds the lines before it.
const ROTATED = 1_792_800_000
const NOW = ROTATED + 300 * 60
const lines = (from: number, count: number, step = 1, sport = 1) =>
  Array.from({ length: count }, (_, i) => fwLine(from + i * step, sport))

const yesterday = lines(ROTATED - 86_400, 144, 600, 7)
const today = [loggerLine(ROTATED), ...lines(ROTATED + 60, 300, 60)]

const ports = (r: { lines: { t: string }[] }) => r.lines.map(e => Number(/SPT=(\d+)/.exec(e.t)?.[1]))

describe('readLogWindow', () => {
  it('reads a window inside the current file from its end, never with since', async () => {
    const log = pveFirewallLog([yesterday, today])
    const res = await readLogWindow(log, { since: NOW - 3600 }, 20_000)

    expect(res.lines).toHaveLength(61)
    expect(res.lines[0]).toEqual({ n: 1, t: fwLine(NOW - 3600) })
    expect(res.lines.at(-1)?.t).toBe(fwLine(NOW))
    expect(res.capped).toBe(false)
    expect(log.calls.every(q => q.since === undefined && q.until === undefined)).toBe(true)
  })

  it('reads only the newest cap lines of a long current file, and says the window held more', async () => {
    const log = pveFirewallLog([yesterday, today])
    const res = await readLogWindow(log, { since: ROTATED }, 50)

    expect(log.calls).toEqual([{ start: 0, limit: 1 }, { start: 251, limit: 50 }])
    expect(res.lines).toHaveLength(50)
    expect(res.lines.at(-1)?.t).toBe(today.at(-1))
    expect(res.capped).toBe(true)
  })

  it('is not capped when the newest cap lines already reach back past the window', async () => {
    const res = await readLogWindow(pveFirewallLog([yesterday, today]), { since: NOW - 600 }, 50)

    expect(res.lines).toHaveLength(11)
    expect(res.capped).toBe(false)
  })

  it('reads the rotated logs only for the part of the window before the current file', async () => {
    const log = pveFirewallLog([yesterday, today])
    const res = await readLogWindow(log, { since: ROTATED - 3600 }, 20_000)

    expect(log.calls.at(-1)).toEqual({ limit: 0, since: ROTATED - 3600, until: ROTATED - 1 })
    expect(ports(res).filter(p => p === 7)).toHaveLength(6)
    expect(res.lines).toHaveLength(6 + today.length)
    expect(res.lines.map(e => e.n)).toEqual(res.lines.map((_, i) => i + 1))
  })

  it('keeps the current file and says what is missing when the rotated logs time out', async () => {
    const log = pveFirewallLog([yesterday, today])
    const slow: LogPageReader = q => (q.since ? Promise.reject(new Error('Orchestrator request timeout')) : log(q))
    const res = await readLogWindow(slow, { since: ROTATED - 86_400 }, 20_000)

    expect(res.lines).toHaveLength(today.length)
    expect(res.missingBefore).toBe(ROTATED * 1000)
    expect((res.olderError as Error).message).toBe('Orchestrator request timeout')
  })

  it('keeps an until bound, and its own second', async () => {
    const log = pveFirewallLog([yesterday, today])
    const res = await readLogWindow(log, { since: ROTATED - 86_400, until: ROTATED - 86_400 + 600 }, 20_000)

    expect(res.lines.map(e => e.t)).toEqual(yesterday.slice(0, 2))
    expect(log.calls.at(-1)).toMatchObject({ until: ROTATED - 86_400 + 600 })
  })

  it('reads the whole window with since when the current file has no line to date it', async () => {
    const log = pveFirewallLog([yesterday, []])
    const res = await readLogWindow(log, { since: ROTATED - 3600 }, 20_000)

    expect(log.calls.at(-1)).toEqual({ limit: 0, since: ROTATED - 3600, until: undefined })
    expect(res.lines).toHaveLength(6)
  })

  it('takes the file start it is given: a guest log does not date the file', async () => {
    const guest = pveFirewallLog([yesterday, [...today, fwLine(NOW - 60).replace(/^0 /, '101 ')]], 101)
    const res = await readLogWindow(guest, { since: NOW - 3600 }, 20_000, () => Promise.resolve(ROTATED * 1000))

    expect(res.lines).toHaveLength(1)
    expect(guest.calls.every(q => q.since === undefined)).toBe(true)
  })
})

describe('currentFileStart', () => {
  it('dates the current file by its first line, the logger start', async () => {
    expect(await currentFileStart(pveFirewallLog([yesterday, today]))).toBe(ROTATED * 1000)
  })

  it('has no date for an empty file', async () => {
    expect(await currentFileStart(pveFirewallLog([[]]))).toBeUndefined()
  })
})

describe('memoReader', () => {
  it('reads each distinct page once', async () => {
    const log = pveFirewallLog([today])
    const memo = memoReader(log)

    await Promise.all([memo({ start: 0, limit: 1 }), memo({ start: 0, limit: 1 }), memo({ start: 5, limit: 1 })])
    expect(log.calls).toEqual([{ start: 0, limit: 1 }, { start: 5, limit: 1 }])
  })
})
