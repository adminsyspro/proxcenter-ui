import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HISTORY_RANGES, hostHistory, recordHostSample, resetHostHistory, SAMPLE_INTERVAL_MS, startHostHistorySampler } from './history'
import type { HostInfo } from './types'

const GIB = 2 ** 30
const host = (over: Partial<HostInfo> = {}): HostInfo => ({
  load1: 1,
  load5: 2,
  load15: 3,
  cpus: 8,
  memTotalBytes: 16 * GIB,
  memAvailableBytes: 10 * GIB,
  uptimeSeconds: 100,
  ...over
})

const NOW = Date.parse('2026-11-17T08:00:00.000Z')

beforeEach(() => {
  resetHostHistory()
})

afterEach(() => {
  resetHostHistory()
  vi.useRealTimers()
})

describe('recordHostSample', () => {
  it('keeps the used memory, not the available one', () => {
    recordHostSample(host(), NOW)

    expect(hostHistory('1h', NOW, host()).samples).toEqual([{ t: NOW, load1: 1, load5: 2, load15: 3, memUsedBytes: 6 * GIB }])
  })

  it('never reports a negative memory on an inconsistent reading', () => {
    recordHostSample(host({ memTotalBytes: 0, memAvailableBytes: GIB }), NOW)

    expect(hostHistory('1h', NOW, null).samples[0].memUsedBytes).toBe(0)
  })

  it('forgets what is older than 24 hours of samples', () => {
    const capacity = HISTORY_RANGES['24h'] / SAMPLE_INTERVAL_MS
    const start = NOW - (capacity + 9) * SAMPLE_INTERVAL_MS

    for (let i = 0; i < capacity + 10; i++) recordHostSample(host({ load1: i }), start + i * SAMPLE_INTERVAL_MS)

    const all = hostHistory('24h', NOW, host())
    const points = all.samples.reduce((sum, s) => sum + 1, 0)

    // The 10 oldest samples are gone: the first bucket starts after them.
    expect(all.samples[0].t).toBeGreaterThanOrEqual(start + 10 * SAMPLE_INTERVAL_MS - all.intervalSeconds * 1000)
    expect(points).toBeLessThanOrEqual(361)
  })
})

describe('hostHistory', () => {
  it('describes the range and the host it was read on', () => {
    expect(hostHistory('6h', NOW, host())).toMatchObject({
      range: '6h',
      from: NOW - 6 * 3600 * 1000,
      to: NOW,
      cpus: 8,
      memTotalBytes: 16 * GIB,
      samples: []
    })
    expect(hostHistory('1h', NOW, null)).toMatchObject({ cpus: 0, memTotalBytes: 0 })
  })

  it('keeps every sample of the last hour and leaves the older ones out', () => {
    recordHostSample(host({ load1: 9 }), NOW - 2 * 3600 * 1000)
    recordHostSample(host({ load1: 1 }), NOW - 60_000)
    recordHostSample(host({ load1: 2 }), NOW - 30_000)

    const history = hostHistory('1h', NOW, host())

    expect(history.intervalSeconds).toBe(30)
    expect(history.samples.map(s => s.load1)).toEqual([1, 2])
  })

  it('averages a long range into buckets a chart can draw', () => {
    // One sample every 30 s over 24 h, the load alternating between 2 and 4.
    for (let t = NOW - HISTORY_RANGES['24h'] + SAMPLE_INTERVAL_MS, i = 0; t <= NOW; t += SAMPLE_INTERVAL_MS, i++) {
      recordHostSample(host({ load1: i % 2 === 0 ? 2 : 4, memAvailableBytes: 8 * GIB }), t)
    }

    const history = hostHistory('24h', NOW, host())

    expect(history.intervalSeconds).toBe(240)
    expect(history.samples.length).toBeLessThanOrEqual(361)
    expect(history.samples.length).toBeGreaterThanOrEqual(359)
    // A full bucket holds 8 samples, half at 2 and half at 4.
    expect(history.samples[10].load1).toBe(3)
    expect(history.samples[10].memUsedBytes).toBe(8 * GIB)
    expect(history.samples[10].t % 240_000).toBe(0)
  })

  it('uses one-minute buckets over 6 hours', () => {
    expect(hostHistory('6h', NOW, null).intervalSeconds).toBe(60)
  })
})

describe('startHostHistorySampler', () => {
  it('samples at once, then every 30 seconds, and only one timer ever runs', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const read = vi.fn(async () => host())

    startHostHistorySampler(read)
    startHostHistorySampler(read)
    await vi.advanceTimersByTimeAsync(0)
    expect(read).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(2 * SAMPLE_INTERVAL_MS)
    expect(read).toHaveBeenCalledTimes(3)
    expect(hostHistory('1h', Date.now(), host()).samples).toHaveLength(3)
  })

  it('survives a reading that fails or finds no host', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const read = vi
      .fn<() => Promise<HostInfo | null>>()
      .mockRejectedValueOnce(new Error('EIO'))
      .mockResolvedValueOnce(null)
      .mockResolvedValue(host())

    startHostHistorySampler(read)
    await vi.advanceTimersByTimeAsync(2 * SAMPLE_INTERVAL_MS)

    expect(read).toHaveBeenCalledTimes(3)
    expect(hostHistory('1h', Date.now(), host()).samples).toHaveLength(1)
  })
})
