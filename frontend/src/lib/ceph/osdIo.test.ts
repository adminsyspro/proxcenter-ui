import { describe, expect, it } from 'vitest'

import { ioMaxGap, ioRate, isOsdCountersSample, mergeIoSeries, OSD_IO_MAX_GAP_MS, OSD_IO_WINDOW_MS, pushIoPoint, type OsdCountersSample, type OsdIoPoint } from './osdIo'

const s = (at: number, over: Partial<OsdCountersSample> = {}): OsdCountersSample => ({ at, op_r: 1000, op_w: 500, op_r_out_bytes: 1_000_000, op_w_in_bytes: 2_000_000, ...over })
const p = (time: number): OsdIoPoint => ({ time, readOps: 1, writeOps: 2, readBytes: 3, writeBytes: 4 })

describe('ioRate', () => {
  it('divides the counter differences by the elapsed seconds', () => {
    const r = ioRate(s(10_000), s(15_000, { op_r: 1100, op_w: 520, op_r_out_bytes: 1_050_000, op_w_in_bytes: 2_500_000 }))

    expect(r).toEqual({ time: 15_000, readOps: 20, writeOps: 4, readBytes: 10_000, writeBytes: 100_000 })
  })

  it('an idle OSD is a real zero', () => {
    expect(ioRate(s(0), s(5000))).toEqual({ time: 5000, readOps: 0, writeOps: 0, readBytes: 0, writeBytes: 0 })
  })

  it('no point when any counter went down (the OSD restarted)', () => {
    for (const k of ['op_r', 'op_w', 'op_r_out_bytes', 'op_w_in_bytes'] as const) {
      expect(ioRate(s(0), s(5000, { [k]: 0 }))).toBeNull()
    }
  })

  it('no point without elapsed time, backwards in time, or after a gap', () => {
    expect(ioRate(s(5000), s(5000))).toBeNull()
    expect(ioRate(s(5000), s(1000))).toBeNull()
    expect(ioRate(s(0), s(OSD_IO_MAX_GAP_MS + 1))).toBeNull()
    expect(ioRate(s(0), s(OSD_IO_MAX_GAP_MS))).not.toBeNull()
  })

  it('the margin is twice the period of the consumer, 15 s at least', () => {
    expect(ioMaxGap(5000)).toBe(15_000)
    expect(ioMaxGap(30_000)).toBe(60_000)
    expect(OSD_IO_MAX_GAP_MS).toBe(15_000)
    // The table polls every 30 s: a reading 30 s + epsilon later is one step, 60 s + epsilon is a gap.
    expect(ioRate(s(0), s(30_500), ioMaxGap(30_000))).not.toBeNull()
    expect(ioRate(s(0), s(60_000), ioMaxGap(30_000))).not.toBeNull()
    expect(ioRate(s(0), s(60_001), ioMaxGap(30_000))).toBeNull()
    // The sheet polls every 5 s: 30 s is a gap there.
    expect(ioRate(s(0), s(15_001))).toBeNull()
  })
})

describe('isOsdCountersSample', () => {
  it('accepts the route contract and refuses anything else', () => {
    expect(isOsdCountersSample({ osd: 0, at: 1, op_r: 1, op_w: 2, op_r_out_bytes: 3, op_w_in_bytes: 4 })).toBe(true)
    expect(isOsdCountersSample({ at: 1, op_r: 1, op_w: 2, op_r_out_bytes: 3 })).toBe(false)
    expect(isOsdCountersSample({ at: 1, op_r: -1, op_w: 2, op_r_out_bytes: 3, op_w_in_bytes: 4 })).toBe(false)
    expect(isOsdCountersSample({ at: 1, op_r: '1', op_w: 2, op_r_out_bytes: 3, op_w_in_bytes: 4 })).toBe(false)
    expect(isOsdCountersSample(null)).toBe(false)
  })
})

describe('pushIoPoint', () => {
  it('keeps the last 5 minutes only', () => {
    const out = pushIoPoint([p(0), p(1000), p(OSD_IO_WINDOW_MS)], p(OSD_IO_WINDOW_MS + 1000))

    expect(out.map(x => x.time)).toEqual([1000, OSD_IO_WINDOW_MS, OSD_IO_WINDOW_MS + 1000])
  })
})

describe('mergeIoSeries', () => {
  it('puts the stored points first and drops the live ones that are not newer', () => {
    expect(mergeIoSeries([p(1), p(2)], [p(2), p(3), p(4)]).map(x => x.time)).toEqual([1, 2, 3, 4])
    expect(mergeIoSeries([], [p(3)]).map(x => x.time)).toEqual([3])
    expect(mergeIoSeries([p(1)], []).map(x => x.time)).toEqual([1])
  })
})
