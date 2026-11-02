import { describe, expect, it } from 'vitest'

import type { CephHistory } from '@/lib/orchestrator/client'

import type { CephLive } from './live'
import { LIVE_INTERVAL_MS } from '@/components/ceph/cockpit/hooks/useCephLive'

import { insertGaps, isSlowOsd, LIVE_STEP_MS, mergeHistoryAndLive, niceAxis, SLOW_OSD_FACTOR, SLOW_OSD_MIN_MS, slowOsdBaseline, seriesFromHistory, seriesFromLive, slowestOsds, tickAxisWidth, type PerfPoint } from './perfSeries'
import type { CephOsd } from './types'

const live = (at: number, over: Partial<CephLive> = {}): CephLive => ({
  health: { status: 'HEALTH_OK', checks: [] },
  pg: { total: 100, clean: 90, byState: [] },
  osd: { total: 3, up: 3, in: 3 },
  io: { readOps: 10, writeOps: 5, readBytes: 1000, writeBytes: 500 },
  recovery: { bytesPerSec: 200, objectsPerSec: 1, degraded: 0, misplaced: 0 },
  raw: { used: 1, total: 2 },
  at,
  ...over,
})

const point = (time: number, over: Record<string, unknown> = {}) => ({
  time, health: 0 as const, read_ops: 1, write_ops: 2, read_bytes: 3, write_bytes: 4, recovering_bytes: 5,
  degraded_objects: 0, misplaced_objects: 0, pgs_total: 10, pgs_clean: 7, raw_used_bytes: 1, raw_total_bytes: 2,
  osd_total: 3, osd_up: 3, osd_in: 3, osd_lat_avg_ms: null, osd_lat_max_ms: null, ...over,
})

const osd = (id: number, commit: number, apply: number, over: Partial<CephOsd> = {}): CephOsd => ({
  id, name: `osd.${id}`, host: 'pve1', status: 'up', up: true, in: true, deviceClass: 'hdd', totalBytes: 1, usedBytes: 0, availBytes: 1,
  usedPct: 0, commitLatencyMs: commit, applyLatencyMs: apply, version: null, ...over,
})

describe('seriesFromLive', () => {
  it('counts unclean PGs as total minus clean and keeps the time in ms', () => {
    const [p] = seriesFromLive([live(1000)])

    expect(p).toEqual({ t: 1000, step: LIVE_STEP_MS, readOps: 10, writeOps: 5, readBytes: 1000, writeBytes: 500, recoveryBytes: 200, pgsUnclean: 10 })
  })

  it('never goes below zero', () => {
    expect(seriesFromLive([live(1, { pg: { total: 0, clean: 3, byState: [] } })])[0].pgsUnclean).toBe(0)
  })
})

describe('seriesFromHistory', () => {
  const history = (points: ReturnType<typeof point>[]): CephHistory => ({ from: '', to: '', step: 60, points, slowest_osds: [] })

  it('converts seconds to ms and keeps the temporal order', () => {
    const out = seriesFromHistory(history([point(200), point(100), point(300)]))

    expect(out.map(p => p.t)).toEqual([100000, 200000, 300000])
    expect(out[0]).toMatchObject({ readOps: 1, writeOps: 2, readBytes: 3, writeBytes: 4, recoveryBytes: 5, pgsUnclean: 3 })
  })

  it('carries the step of the period on every point, in ms', () => {
    expect(seriesFromHistory(history([point(100), point(160)])).map(p => p.step)).toEqual([60000, 60000])
    expect(seriesFromHistory({ ...history([point(100)]), step: 300 })[0].step).toBe(300000)
  })

  it('falls back to a minute when the period carries no usable step', () => {
    expect(seriesFromHistory({ ...history([point(100)]), step: 0 })[0].step).toBe(60000)
  })
})

describe('LIVE_STEP_MS', () => {
  it('is the polling period of the Live hook', () => {
    expect(LIVE_STEP_MS).toBe(LIVE_INTERVAL_MS)
  })
})

describe('insertGaps', () => {
  it('puts an empty row inside a collection gap so the line breaks there', () => {
    const base = { readOps: 1, writeOps: 1, readBytes: 1, writeBytes: 1, recoveryBytes: 1, pgsUnclean: 1 }
    const rows = insertGaps([0, 60000, 120000, 600000, 660000].map(t => ({ t, ...base })))

    expect(rows).toHaveLength(6)
    expect(rows[3]).toMatchObject({ t: 120001, readOps: null, pgsUnclean: null })
  })

  it('leaves a regular series alone', () => {
    const base = { readOps: 1, writeOps: 1, readBytes: 1, writeBytes: 1, recoveryBytes: 1, pgsUnclean: 1 }

    expect(insertGaps([0, 5000, 10000, 15000].map(t => ({ t, ...base })))).toHaveLength(4)
  })
})

const full = { readOps: 1, writeOps: 1, readBytes: 1, writeBytes: 1, recoveryBytes: 1, pgsUnclean: 1 }
const hp = (t: number, over: Partial<PerfPoint> = {}): PerfPoint => ({ t, step: 60000, ...full, readOps: 100, ...over })
const lp = (t: number, over: Partial<PerfPoint> = {}): PerfPoint => ({ t, step: 5000, ...full, readOps: 10, ...over })

describe('insertGaps with mixed steps', () => {
  it('does not cut between two history points one minute apart', () => {
    const rows = insertGaps([0, 60000, 120000, 180000].map(t => hp(t)))

    expect(rows).toHaveLength(4)
  })

  it('cuts when two history points are further apart than 2.5 times their step', () => {
    const rows = insertGaps([0, 60000, 60000 + 160000, 60000 + 220000].map(t => hp(t)))

    expect(rows).toHaveLength(5)
    expect(rows[2]).toMatchObject({ t: 60001, readOps: null })
  })

  it('does not cut between a history point and a live point one minute apart (the coarser step rules)', () => {
    const rows = insertGaps([hp(0), hp(60000), lp(120000), lp(125000), lp(130000)])

    expect(rows.every(r => r.readOps !== null)).toBe(true)
  })

  it('still cuts the live line on a hole of 2.5 live steps', () => {
    const rows = insertGaps([lp(0), lp(5000), lp(10000), lp(30000), lp(35000)])

    expect(rows).toHaveLength(6)
    expect(rows[3]).toMatchObject({ t: 10001, readOps: null })
  })

  it('a Live polling slowed down by Ceph (15 s between readings) does not cut every point, a real hole still does', () => {
    const slow = [0, 15000, 30000, 45000, 60000].map(t => lp(t))

    expect(insertGaps(slow)).toHaveLength(5)

    const withHole = insertGaps([0, 15000, 30000, 45000, 60000, 180000, 195000].map(t => lp(t)))

    expect(withHole.filter(r => r.readOps === null)).toHaveLength(1)
  })

  it('keeps the median rule for points without a step', () => {
    const rows = insertGaps([0, 60000, 120000, 600000, 660000].map(t => ({ t, ...full })))

    expect(rows).toHaveLength(6)
  })

  it('cuts a pair of points that carry a step even when there are only two', () => {
    expect(insertGaps([hp(0), hp(400000)])).toHaveLength(3)
    expect(insertGaps([hp(0), hp(60000)])).toHaveLength(2)
  })
})

describe('mergeHistoryAndLive', () => {
  it('returns the live points alone without history, and the history alone without a buffer', () => {
    const live = [lp(1000), lp(6000)]
    const hist = [hp(0), hp(60000)]

    expect(mergeHistoryAndLive([], live)).toEqual(live)
    expect(mergeHistoryAndLive(hist, [])).toEqual(hist)
  })

  it('fills the hole of the buffer with the history, in time order', () => {
    const live = [lp(600_000), lp(605_000), lp(610_000), lp(900_000), lp(905_000)]
    const hist = [0, 60_000, 120_000, 180_000, 240_000, 300_000, 360_000, 420_000, 480_000, 540_000, 600_000, 660_000, 720_000, 780_000, 840_000].map(t => hp(t))
    const out = mergeHistoryAndLive(hist, live)

    expect(out.map(p => p.t)).toEqual([...out.map(p => p.t)].sort((a, b) => a - b))
    // history points inside the hole (660 000 to 840 000) are kept; the one at 600 000 is covered by live points
    expect(out.filter(p => p.step === 60000).map(p => p.t)).toEqual([0, 60_000, 120_000, 180_000, 240_000, 300_000, 360_000, 420_000, 480_000, 540_000, 660_000, 720_000, 780_000, 840_000])
    expect(out.filter(p => p.step === 5000)).toHaveLength(5)
  })

  it('keeps no history point whose minute holds a live point (no duplicate, no round trip)', () => {
    const live = [lp(130_000), lp(135_000)]
    const out = mergeHistoryAndLive([hp(60_000), hp(120_000), hp(180_000)], live)

    expect(out.map(p => p.t)).toEqual([60_000, 130_000, 135_000, 180_000])
    expect(out.find(p => p.t === 120_000)).toBeUndefined()
  })

  it('a history point right after the last live point of the minute is dropped, the next minute kept', () => {
    const out = mergeHistoryAndLive([hp(120_000), hp(180_000)], [lp(179_999)])

    expect(out.map(p => p.t)).toEqual([179_999, 180_000])
  })

  it('does not mutate its inputs and keeps each point step and values', () => {
    const hist = [hp(0)]
    const live = [lp(120_000, { pgsUnclean: 4, recoveryBytes: 7 })]

    mergeHistoryAndLive(hist, live)
    expect(hist).toEqual([hp(0)])
    expect(mergeHistoryAndLive(hist, live)[1]).toMatchObject({ pgsUnclean: 4, recoveryBytes: 7, step: 5000 })
  })

  it('the merged series draws the hole filled, with one cut where a real hole remains', () => {
    const live = [lp(600_000), lp(605_000), lp(1_800_000), lp(1_805_000)]
    const hist = Array.from({ length: 30 }, (_, i) => hp(i * 60_000))
    const rows = insertGaps(mergeHistoryAndLive(hist, live))

    // history is continuous up to the last minute before the second live run, then 5 s points
    expect(rows.filter(r => r.readOps === null)).toHaveLength(0)
  })

  it('leaves a real hole (no source covers it) as a cut', () => {
    const rows = insertGaps(mergeHistoryAndLive([hp(0), hp(60_000)], [lp(600_000), lp(605_000)]))

    expect(rows.filter(r => r.readOps === null)).toHaveLength(1)
  })
})

describe('slowestOsds', () => {
  it('takes the history ranking over a period, sorted by mean, capped at 8', () => {
    const slowest = Array.from({ length: 12 }, (_, i) => ({ osd_id: i, avg_ms: i, max_ms: i * 2 }))
    const out = slowestOsds({ history: { from: '', to: '', step: 60, points: [], slowest_osds: slowest } })

    expect(out).toHaveLength(8)
    expect(out.map(o => o.id)).toEqual([11, 10, 9, 8, 7, 6, 5, 4])
    expect(out[0]).toEqual({ id: 11, avgMs: 11, maxMs: 22 })
  })

  it('in Live uses the inventory latencies, skips down OSDs and OSDs without a reading', () => {
    const out = slowestOsds({ osds: [osd(0, 2, 3), osd(1, 9, 4), osd(2, 0, 0, { up: false }), osd(3, Number.NaN, Number.NaN), osd(4, 0, 0)] })

    expect(out.map(o => o.id)).toEqual([1, 0, 4])
    expect(out[0]).toEqual({ id: 1, avgMs: 9, maxMs: 9 })
  })

  it('limits the Live ranking to n', () => {
    const osds = Array.from({ length: 20 }, (_, i) => osd(i, i + 1, 0))

    expect(slowestOsds({ osds }, 3).map(o => o.id)).toEqual([19, 18, 17])
  })

  it('is empty with no source', () => {
    expect(slowestOsds({})).toEqual([])
  })
})

describe('niceAxis', () => {
  it('rounds the maximum up to four clean intervals', () => {
    expect(niceAxis(528)).toEqual({ max: 600, ticks: [0, 150, 300, 450, 600] })
    expect(niceAxis(1000)).toEqual({ max: 1000, ticks: [0, 250, 500, 750, 1000] })
  })

  it('works in the display unit and scales back to bytes', () => {
    const MiB = 1024 ** 2

    expect(niceAxis(77 * MiB, MiB)).toEqual({ max: 80 * MiB, ticks: [0, 20, 40, 60, 80].map(v => v * MiB) })
  })

  it('keeps counts whole and never draws a zero-high axis', () => {
    expect(niceAxis(3, 1, true).ticks).toEqual([0, 1, 2, 3, 4])
    expect(niceAxis(0, 1, true).max).toBe(4)
    expect(niceAxis(0).ticks[4]).toBeGreaterThan(0)
  })
})

describe('slow OSD rule', () => {
  it('names its thresholds', () => {
    expect(SLOW_OSD_MIN_MS).toBe(10)
    expect(SLOW_OSD_FACTOR).toBe(2)
  })

  it('needs both: at least 10 ms and at least twice the baseline', () => {
    expect(isSlowOsd(10, 5)).toBe(true)
    expect(isSlowOsd(12, 7)).toBe(false)
    expect(isSlowOsd(9.9, 2)).toBe(false)
    expect(isSlowOsd(9, 4)).toBe(false)
    expect(isSlowOsd(30, null)).toBe(false)
  })

  it('baseline in Live is the median of every up OSD with a reading, the lower one on an even count', () => {
    const osds = [osd(0, 2, 2), osd(1, 4, 4), osd(2, 90, 90), osd(3, 3, 3), osd(4, 500, 500, { up: false }), osd(5, Number.NaN, Number.NaN)]

    expect(slowOsdBaseline(osds)).toBe(3)
    expect(slowOsdBaseline([osd(0, 40, 40), osd(1, 2, 2)])).toBe(2)
    expect(slowOsdBaseline([])).toBeNull()
  })

  it('flags the slow one of only 2 OSDs', () => {
    expect(isSlowOsd(40, slowOsdBaseline([osd(0, 40, 40), osd(1, 2, 2)]))).toBe(true)
  })

  it('on 500 OSDs at 2 ms the baseline is the cluster one, so a 25 ms OSD outside the displayed 8 is still told apart', () => {
    const osds = Array.from({ length: 500 }, (_, i) => osd(i, 2, 2))
    osds[7] = osd(7, 25, 25)
    const base = slowOsdBaseline(osds)

    expect(base).toBe(2)
    expect(slowestOsds({ osds })[0]).toEqual({ id: 7, avgMs: 25, maxMs: 25 })
    expect(isSlowOsd(25, base)).toBe(true)
    expect(slowestOsds({ osds }).slice(1).some(o => isSlowOsd(o.avgMs, base))).toBe(false)
  })
})

describe('tickAxisWidth', () => {
  it('is never under the minimum and grows with the longest label', () => {
    expect(tickAxisWidth(['0', '60', '120'], 62)).toBe(62)
    expect(tickAxisWidth(['0', '50 KiB/s', '200 KiB/s'], 62)).toBeGreaterThan(62)
    expect(tickAxisWidth(['800 MiB/s'], 0)).toBeGreaterThan(tickAxisWidth(['200 KiB/s'], 0) - 1)
    expect(tickAxisWidth([], 40)).toBe(40)
  })

  it('leaves room for at least six pixels per character', () => {
    for (const label of ['200 KiB/s', '240 KiB/s', '800 MiB/s', '1,024 GiB/s']) expect(tickAxisWidth([label], 0)).toBeGreaterThanOrEqual(label.length * 6)
  })
})
