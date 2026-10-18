import { describe, expect, it } from 'vitest'

import { addThroughputSample, emptyThroughput, formatMBps, MB, THROUGHPUT_MAX_POINTS, THROUGHPUT_TOTAL_KEY, THROUGHPUT_STALL_MS, THROUGHPUT_WINDOW_MS, throughputChart, type ThroughputJob, parseTransferSpeed, axisTicks, axisTimeLabel } from './migrationThroughput'

const job = (id: string, bytes: number | null, status = 'transferring'): ThroughputJob => ({ id, name: `vm-${id}`, status, bytesTransferred: bytes })

describe('addThroughputSample', () => {
  it('derives each job rate from the counter delta over the time between two polls, summed', () => {
    let s = emptyThroughput('b1')
    s = addThroughputSample(s, [job('a', 0), job('b', 100 * MB)], 0)
    expect(s.samples[0].total).toBe(0)
    s = addThroughputSample(s, [job('a', 30 * MB), job('b', 160 * MB)], 3000)
    expect(s.samples[1].byJob).toEqual({ a: 10 * MB, b: 20 * MB })
    expect(s.samples[1].total).toBe(30 * MB)
  })

  it('takes nothing negative from a job that restarted its copy, and measures again from there', () => {
    let s = emptyThroughput('b1')
    s = addThroughputSample(s, [job('a', 500 * MB)], 0)
    s = addThroughputSample(s, [job('a', 10 * MB)], 3000)
    expect(s.samples[1].total).toBe(0)
    s = addThroughputSample(s, [job('a', 40 * MB)], 6000)
    expect(s.samples[2].total).toBe(10 * MB)
  })

  it('drops a job that finished, failed or is queued', () => {
    let s = emptyThroughput('b1')
    s = addThroughputSample(s, [job('a', 0), job('b', 0)], 0)
    s = addThroughputSample(s, [job('a', 30 * MB, 'completed'), job('b', 30 * MB, 'queued')], 3000)
    expect(s.samples[1].total).toBe(0)
    expect(s.baselines).toEqual({})
  })

  it('keeps the last rate while the counter waits for its next write, then says 0 for a stalled job', () => {
    let s = emptyThroughput('b1')
    s = addThroughputSample(s, [job('a', 0)], 0)
    s = addThroughputSample(s, [job('a', 30 * MB)], 3000)
    s = addThroughputSample(s, [job('a', 30 * MB)], 6000)
    expect(s.samples[2].total).toBe(10 * MB)
    // The next write spreads over the whole time since the counter last moved.
    s = addThroughputSample(s, [job('a', 90 * MB)], 9000)
    expect(s.samples[3].total).toBe(10 * MB)
    s = addThroughputSample(s, [job('a', 90 * MB)], 9000 + THROUGHPUT_STALL_MS)
    expect(s.samples[4].total).toBe(0)
  })

  it('ignores a look closer than a second to the previous one (a re-render, not a poll)', () => {
    let s = emptyThroughput('b1')
    s = addThroughputSample(s, [job('a', 0)], 0)
    const same = addThroughputSample(s, [job('a', 10 * MB)], 500)
    expect(same).toBe(s)
  })

  it('skips a running job without a counter yet', () => {
    let s = emptyThroughput('b1')
    s = addThroughputSample(s, [job('a', null)], 0)
    s = addThroughputSample(s, [job('a', 30 * MB)], 3000)
    expect(s.samples[1].total).toBe(0)
  })

  it('keeps 24 hours of samples, the longest range', () => {
    let s = emptyThroughput('b1')
    const step = 10 * 60_000
    for (let t = 0; t <= THROUGHPUT_WINDOW_MS + 2 * step; t += step) s = addThroughputSample(s, [job('a', t)], t)
    const last = s.samples[s.samples.length - 1].t
    expect(THROUGHPUT_WINDOW_MS).toBe(24 * 60 * 60_000)
    expect(s.samples[0].t).toBeGreaterThanOrEqual(last - THROUGHPUT_WINDOW_MS)
    expect(s.samples.length).toBe(THROUGHPUT_WINDOW_MS / step + 1)
  })
})

describe('throughputChart', () => {
  it('names every VM that moved data in the range, finished ones included: no "other" area', () => {
    let s = emptyThroughput('b1')
    s = addThroughputSample(s, [job('a', 0), job('b', 0)], 0)
    s = addThroughputSample(s, [job('a', 30 * MB), job('b', 60 * MB)], 3000)
    const jobs = [job('a', 30 * MB, 'completed'), job('b', 60 * MB)]
    const c = throughputChart(s, jobs)
    expect(c.series).toEqual([{ key: 'a', name: 'vm-a' }, { key: 'b', name: 'vm-b' }])
    // Each VM at its own rate (the chart does not stack them), the total beside.
    expect(c.rows[1]).toEqual({ t: 3000, a: 10, b: 20, [THROUGHPUT_TOTAL_KEY]: 30 })
    expect(c.currentBps).toBe(30 * MB)
    expect(c.peakBps).toBe(30 * MB)
  })

  it('draws every VM of a large batch, one area each', () => {
    const six = ['1', '2', '3', '4', '5', '6']
    let s = emptyThroughput('b1')
    s = addThroughputSample(s, six.map(id => job(id, 0)), 0)
    s = addThroughputSample(s, six.map(id => job(id, 3 * MB)), 3000)
    const c = throughputChart(s, six.map(id => job(id, 3 * MB)))
    expect(c.series.map(x => x.name)).toEqual(six.map(id => `vm-${id}`))
    expect(c.rows[1]).toMatchObject({ '1': 1, '6': 1 })
  })

  it('shows only the picked range and averages a long one into a bounded number of points', () => {
    let s = emptyThroughput('b1')
    for (let t = 0, b = 0; t <= 2 * 60 * 60_000; t += 3000, b += 30 * MB) s = addThroughputSample(s, [job('a', b)], t)
    const last = s.samples[s.samples.length - 1].t
    const oneMin = throughputChart(s, [job('a', 0)], '1m')
    expect(oneMin.rows[0].t).toBeGreaterThanOrEqual(last - 60_000)
    expect(oneMin.rows.length).toBeLessThanOrEqual(21)
    const day = throughputChart(s, [job('a', 0)], '24h')
    expect(day.rows.length).toBeLessThanOrEqual(THROUGHPUT_MAX_POINTS)
    expect(day.rows.at(-1)!.a).toBeCloseTo(10, 5)
  })

  it('reports the peak of the window, not the last value', () => {
    let s = emptyThroughput('b1')
    s = addThroughputSample(s, [job('a', 0)], 0)
    s = addThroughputSample(s, [job('a', 60 * MB)], 3000)
    s = addThroughputSample(s, [job('a', 63 * MB)], 6000)
    const c = throughputChart(s, [job('a', 63 * MB)])
    expect(c.peakBps).toBe(20 * MB)
    expect(c.currentBps).toBe(1 * MB)
  })
})

describe('formatMBps', () => {
  it('formats bytes per second as MB/s', () => {
    expect(formatMBps(12.34 * MB)).toBe('12.3 MB/s')
    expect(formatMBps(-1)).toBe('0.0 MB/s')
  })
})

describe('engine-published rate (warm engines write every 30 s)', () => {
  it('parses a copy rate and ignores the zeroing of the target', () => {
    expect(parseTransferSpeed('33 MB/s')).toBe(33 * MB)
    expect(parseTransferSpeed('1.5 GB/s')).toBe(1.5 * 1024 * MB)
    expect(parseTransferSpeed('512 KB/s')).toBe(512 * 1024)
    expect(parseTransferSpeed('Zeroing: 120 MB/s')).toBeNull()
    expect(parseTransferSpeed(null)).toBeNull()
    expect(parseTransferSpeed('fast')).toBeNull()
  })

  it('charts the published rate from the first look, before the counter ever moves', () => {
    const s = addThroughputSample(emptyThroughput('b'), [{ id: 'j1', name: 'a', status: 'full_copy', bytesTransferred: 0, transferSpeed: '33 MB/s' }], 1000)
    expect(s.samples.at(-1)?.total).toBe(33 * MB)
  })

  it('keeps a counter-derived rate for a whole engine interval', () => {
    let s = emptyThroughput('b')
    s = addThroughputSample(s, [{ id: 'j1', name: 'a', status: 'full_copy', bytesTransferred: 0 }], 0)
    s = addThroughputSample(s, [{ id: 'j1', name: 'a', status: 'full_copy', bytesTransferred: 30 * MB }], 30_000)
    s = addThroughputSample(s, [{ id: 'j1', name: 'a', status: 'full_copy', bytesTransferred: 30 * MB }], 57_000)
    expect(s.samples.at(-1)?.total).toBe(MB)
  })

  it('counts a running job with a rate but no counter yet', () => {
    const s = addThroughputSample(emptyThroughput('b'), [{ id: 'j1', name: 'a', status: 'transferring', bytesTransferred: null, transferSpeed: '10 MB/s' }], 1000)
    expect(s.samples.at(-1)?.byJob).toEqual({ j1: 10 * MB })
  })
})

describe('time axis (roadmap#53)', () => {
  const base = new Date(2026, 9, 18, 9, 13, 0).getTime()
  it('never repeats a label, and shows seconds on a short window', () => {
    const ticks = axisTicks(base, base + 40_000, 'en-GB')
    const labels = ticks.map(t => axisTimeLabel(t, 40_000, 'en-GB'))
    expect(new Set(labels).size).toBe(labels.length)
    expect(labels[0]).toBe('09:13:00')
    expect(labels).toContain('09:13:40')
  })
  it('drops the seconds past ten minutes and dedupes', () => {
    expect(axisTimeLabel(base, 20 * 60_000, 'en-GB')).toBe('09:13')
    expect(axisTicks(base, base + 2_000, 'en-GB').length).toBeLessThanOrEqual(3)
    expect(axisTicks(base, base, 'en-GB')).toEqual([base])
  })
})
