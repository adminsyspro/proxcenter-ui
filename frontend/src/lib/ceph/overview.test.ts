import { describe, expect, it } from 'vitest'

import type { CephHistory } from '@/lib/orchestrator/client'

import type { CephLive } from './live'
import {
  binaryUnit, byteRateUnit, osdLatency, osdLatencyMs, poolFillRatio, recoveryShown, seriesFromBuffer, tileSeriesFromHistory,
} from './overview'

const live = (over: Partial<CephLive> = {}): CephLive => ({
  health: { status: 'HEALTH_OK', checks: [] },
  pg: { total: 1, clean: 1, byState: [] },
  osd: { total: 3, up: 3, in: 3 },
  io: { readOps: 10, writeOps: 2, readBytes: 1024, writeBytes: 512 },
  recovery: { bytesPerSec: 0, objectsPerSec: 0, degraded: 0, misplaced: 0 },
  raw: { used: 82, total: 100 },
  at: 1,
  ...over,
})

describe('poolFillRatio', () => {
  it('reads Ceph fraction as is and a percentage as a percentage', () => {
    expect(poolFillRatio(0.86)).toBe(0.86)
    expect(poolFillRatio(55)).toBe(0.55)
    expect(poolFillRatio(Number.NaN)).toBe(0)
    expect(poolFillRatio(250)).toBe(1)
  })
})

describe('osdLatency', () => {
  it('averages the up OSDs and names the slowest', () => {
    expect(osdLatency([
      { id: 0, up: true, commitLatencyMs: 1, applyLatencyMs: 1 },
      { id: 1, up: true, commitLatencyMs: 3, applyLatencyMs: 2 },
      { id: 2, up: false, commitLatencyMs: 90, applyLatencyMs: 90 },
    ])).toEqual({ avg: 2, max: 3, maxOsd: 1 })
  })

  it('leaves out an OSD without a latency reading, never counting it as 0 ms', () => {
    const missing = { id: 3, up: true, commitLatencyMs: undefined, applyLatencyMs: Number.NaN } as unknown as { id: number; up: boolean; commitLatencyMs: number; applyLatencyMs: number }

    expect(osdLatency([{ id: 0, up: true, commitLatencyMs: 4, applyLatencyMs: 4 }, missing])).toEqual({ avg: 4, max: 4, maxOsd: 0 })
    expect(osdLatency([missing])).toBeNull()
    expect(osdLatencyMs(missing)).toBeNull()
    expect(osdLatencyMs({ commitLatencyMs: 0, applyLatencyMs: 0 })).toBe(0)
  })

  it('has nothing to say without an up OSD', () => {
    expect(osdLatency([{ id: 0, up: false, commitLatencyMs: 0, applyLatencyMs: 0 }])).toBeNull()
  })
})

describe('byteRateUnit', () => {
  it('picks a binary unit from the largest figure', () => {
    expect(byteRateUnit(512)).toEqual({ divisor: 1, unit: 'B/s' })
    expect(byteRateUnit(180 * 1024)).toEqual({ divisor: 1024, unit: 'KiB/s' })
    expect(byteRateUnit(3 * 1024 ** 3)).toEqual({ divisor: 1024 ** 3, unit: 'GiB/s' })
  })

  it('gives sizes without the rate', () => {
    expect(binaryUnit(300 * 1024 ** 3)).toEqual({ divisor: 1024 ** 3, unit: 'GiB' })
    expect(binaryUnit(2 * 1024 ** 5)).toEqual({ divisor: 1024 ** 5, unit: 'PiB' })
  })
})

describe('recoveryShown', () => {
  it('shows the banner on recovery or degraded objects only', () => {
    expect(recoveryShown(live())).toBe(false)
    expect(recoveryShown(live({ recovery: { bytesPerSec: 1, objectsPerSec: 0, degraded: 0, misplaced: 0 } }))).toBe(true)
    expect(recoveryShown(live({ recovery: { bytesPerSec: 0, objectsPerSec: 0, degraded: 3, misplaced: 0 } }))).toBe(true)
    expect(recoveryShown(live({ recovery: { bytesPerSec: 0, objectsPerSec: 0, degraded: 0, misplaced: 9 } }))).toBe(false)
    expect(recoveryShown(null)).toBe(false)
  })
})

describe('series', () => {
  it('reads the Live buffer, without latency (it comes from the inventory)', () => {
    const s = seriesFromBuffer([live(), live({ io: { readOps: 20, writeOps: 4, readBytes: 2048, writeBytes: 0 }, raw: { used: 0, total: 0 } })])

    expect(s.readOps).toEqual([10, 20])
    expect(s.writeBytes).toEqual([512, 0])
    expect(s.rawRatio).toEqual([0.82])
    expect(s.latencyAvg).toEqual([])
  })

  it('reads the history and skips the buckets without latency', () => {
    const point = (lat: number | null) => ({
      time: 1, health: 0 as const, read_ops: 5, write_ops: 1, read_bytes: 10, write_bytes: 20, recovering_bytes: 0, degraded_objects: 0,
      misplaced_objects: 0, pgs_total: 1, pgs_clean: 1, raw_used_bytes: 50, raw_total_bytes: 100, osd_total: 3, osd_up: 3, osd_in: 3,
      osd_lat_avg_ms: lat, osd_lat_max_ms: lat,
    })
    const h: CephHistory = { from: '', to: '', step: 60, points: [point(1.5), point(null), point(2)], slowest_osds: [] }
    const s = tileSeriesFromHistory(h)

    expect(s.readOps).toEqual([5, 5, 5])
    expect(s.rawRatio).toEqual([0.5, 0.5, 0.5])
    expect(s.latencyAvg).toEqual([1.5, 2])
  })
})
