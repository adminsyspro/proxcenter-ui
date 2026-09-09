import { describe, expect, it } from 'vitest'

import type { DiskLatencySeriesPoint } from '@/lib/orchestrator/client'

import { diskFromLatencyKey, inferStepSeconds, latencyKey, mergeLatencySeries, seriesBounds, diskIoTooltipRow } from './latencySeries'

const startSec = Date.parse('2026-09-08T12:00:00.000Z') / 1000
const series = [0, 60, 120].map((offset, i) => ({
  t: (startSec + offset) * 1000, diskReadBps: (i + 1) * 100, diskWriteBps: i * 50,
}))
const point = (overrides: Partial<DiskLatencySeriesPoint> = {}): DiskLatencySeriesPoint => ({
  time: startSec, disk: 'scsi0', latency_ms: 8, max_ms: 12, read_ops: 10, write_ops: 0,
  ...overrides,
})

describe('latencyKey / diskFromLatencyKey', () => {
  it.each(['scsi0', 'virtio1', 'disk_with_underscores'])('round trips %s', disk => {
    expect(latencyKey(disk)).toBe(`lat_${disk}`)
    expect(diskFromLatencyKey(latencyKey(disk))).toBe(disk)
  })

  it('returns null for a bandwidth key', () => {
    expect(diskFromLatencyKey('diskReadBps')).toBeNull()
  })
})

describe('inferStepSeconds', () => {
  it.each([
    { label: 'empty series', offsets: [], expected: 60 },
    { label: 'single point', offsets: [0], expected: 60 },
    { label: 'one-minute points', offsets: [0, 60, 120], expected: 60 },
    { label: '30-minute points', offsets: [0, 1800, 3600], expected: 1800 },
    { label: 'jittered gaps of 59, 61 and 60 seconds', offsets: [0, 59, 120, 180], expected: 60 },
    { label: 'sub-minute gaps', offsets: [0, 10, 20], expected: 60 },
    { label: 'duplicate and decreasing timestamps', offsets: [60, 60, 0], expected: 60 },
  ])('infers $expected seconds for $label', ({ offsets, expected }) => {
    expect(inferStepSeconds(offsets.map(offset => ({ t: (startSec + offset) * 1000 })))).toBe(expected)
  })
})

describe('seriesBounds', () => {
  it('returns null for an empty series', () => {
    expect(seriesBounds([], 60)).toBeNull()
  })

  it.each([60, 1800])('converts milliseconds to seconds and aligns bounds to %s-second buckets', step => {
    const data = [{ t: startSec * 1000 + 12500 }, { t: (startSec + step * 2) * 1000 + 45750 }]

    expect(seriesBounds(data, step)).toEqual({ fromSec: startSec, toSec: startSec + step * 3 })
  })

  it('includes the last point even when it is exactly on a bucket boundary', () => {
    expect(seriesBounds(series, 60)).toEqual({ fromSec: startSec, toSec: startSec + 180 })
  })
})

describe('mergeLatencySeries', () => {
  it('joins seconds onto millisecond buckets with one sorted key per active disk and preserves original fields', () => {
    const data = series.map(pt => ({ ...pt, t: pt.t + 15000 }))
    const original = data.map(pt => ({ ...pt }))
    const result = mergeLatencySeries(data, [
      point({ disk: 'virtio1', time: startSec + 5, latency_ms: 2, read_ops: 0, write_ops: 3 }),
      point({ time: startSec + 61, latency_ms: 4 }),
      point({ time: startSec + 10, latency_ms: 8 }),
      point({ time: startSec + 121, latency_ms: 0, read_ops: 0, write_ops: 0 }),
    ], 60)

    expect(result.disks).toEqual(['scsi0', 'virtio1'])
    expect(result.data).toStrictEqual([
      { ...original[0], lat_scsi0: 8, lat_virtio1: 2 },
      { ...original[1], lat_scsi0: 4, lat_virtio1: undefined },
      { ...original[2], lat_scsi0: 0, lat_virtio1: undefined },
    ])
    expect(data).toStrictEqual(original)
  })

  it('omits disks and keys when all their read and write operation counts are zero', () => {
    const idle = series.map(pt => point({ disk: 'scsi1', time: pt.t / 1000, read_ops: 0, write_ops: 0 }))
    const result = mergeLatencySeries(series, [point(), ...idle], 60)

    expect(result.disks).toEqual(['scsi0'])
    expect(result.data).toStrictEqual(series.map((pt, i) => ({ ...pt, lat_scsi0: i === 0 ? 8 : undefined })))
    for (const pt of result.data) expect(pt).not.toHaveProperty('lat_scsi1')
    expect(mergeLatencySeries(series, idle, 60)).toStrictEqual({ data: series, disks: [] })
  })

  it('ignores points with missing disks or non-numeric times', () => {
    const { disk: _disk, ...missingDisk } = point()
    const invalid = [
      missingDisk,
      point({ disk: '' }),
      { ...point({ disk: 'scsi1' }), time: String(startSec) },
      { ...point({ disk: 'scsi2' }), time: null },
      { ...point({ disk: 'scsi3' }), time: undefined },
    ] as unknown as DiskLatencySeriesPoint[]

    expect(mergeLatencySeries(series, invalid, 60)).toStrictEqual({ data: series, disks: [] })
    expect(mergeLatencySeries(series, [...invalid, point()], 60)).toStrictEqual({
      data: series.map((pt, i) => ({ ...pt, lat_scsi0: i === 0 ? 8 : undefined })), disks: ['scsi0'],
    })
  })

  it('returns equal input data and no disks for empty latency points', () => {
    expect(mergeLatencySeries(series, [], 60)).toStrictEqual({ data: series, disks: [] })
  })
})

describe('diskIoTooltipRow', () => {
  const formatBps = (bps: number) => `${bps} B/s`

  it('keeps the bandwidth rows as they were', () => {
    expect(diskIoTooltipRow('diskReadBps', 1024, formatBps, 'Disk latency')).toEqual({ label: 'Read', value: '1024 B/s' })
    expect(diskIoTooltipRow('diskWriteBps', 5, formatBps, 'Disk latency')).toEqual({ label: 'Write', value: '5 B/s' })
  })

  it('names the disk and formats a latency row in milliseconds', () => {
    expect(diskIoTooltipRow('lat_scsi0', 12.4, formatBps, 'Disk latency')).toEqual({ label: 'scsi0 · Disk latency', value: '12 ms' })
    expect(diskIoTooltipRow('lat_sata0', 0.42, formatBps, 'Latence')).toEqual({ label: 'sata0 · Latence', value: '0.4 ms' })
  })
})
