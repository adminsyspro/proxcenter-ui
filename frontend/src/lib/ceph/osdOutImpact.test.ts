import { describe, expect, it } from 'vitest'

import { osdOutImpact, type OsdLoad } from './osdOutImpact'

const TB = 1e12
const ratios = { nearfull: 0.85, full: 0.95 }

function osd(id: number, ratio: number, over: Partial<OsdLoad> = {}): OsdLoad {
  return { id, host: `pve${id + 1}`, deviceClass: 'hdd', usedBytes: ratio * TB, totalBytes: TB, crushWeight: 1, up: true, in: true, ...over }
}

describe('osdOutImpact', () => {
  it('spreads the target data over the other OSDs of the class', () => {
    const r = osdOutImpact([osd(0, 0.5), osd(1, 0.5), osd(2, 0.5)], 0, ratios)
    expect(r.movedBytes).toBeCloseTo(0.5 * TB)
    expect(r.maxProjectedRatio).toBeCloseTo(0.75)
    expect(r.overNearfull).toBe(false)
    expect(r.overFull).toBe(false)
    expect(r.receivers).toBe(2)
  })

  it('flags nearfull when the projection crosses the threshold', () => {
    const r = osdOutImpact([osd(0, 0.6), osd(1, 0.6), osd(2, 0.6)], 0, ratios)
    expect(r.maxProjectedRatio).toBeCloseTo(0.9)
    expect(r.overNearfull).toBe(true)
    expect(r.overFull).toBe(false)
    expect(r.maxProjectedOsd).not.toBeNull()
  })

  it('does not feed OSDs of another class, nor down or out ones', () => {
    const r = osdOutImpact(
      [osd(0, 0.5), osd(1, 0.5), osd(2, 0.5, { deviceClass: 'ssd' }), osd(3, 0.5, { up: false }), osd(4, 0.5, { in: false })],
      0,
      ratios,
    )
    expect(r.receivers).toBe(1)
    expect(r.maxProjectedOsd).toBe(1)
    expect(r.maxProjectedRatio).toBeCloseTo(1)
    expect(r.overFull).toBe(true)
  })

  it('weights the share by the CRUSH weight', () => {
    const r = osdOutImpact([osd(0, 0.4), osd(1, 0.1, { crushWeight: 3 }), osd(2, 0.1, { crushWeight: 1 })], 0, ratios)
    expect(r.maxProjectedRatio).toBeCloseTo(0.4)
    expect(r.maxProjectedOsd).toBe(1)
  })

  it('reports no receiver when the OSD is alone in its class', () => {
    const r = osdOutImpact([osd(0, 0.3), osd(1, 0.3, { deviceClass: 'ssd' })], 0, ratios)
    expect(r.receivers).toBe(0)
    expect(r.overFull).toBe(true)
    expect(r.overNearfull).toBe(true)
    expect(r.maxProjectedOsd).toBeNull()
  })

  it('has no impact when the target is already out', () => {
    const r = osdOutImpact([osd(0, 0.9, { in: false }), osd(1, 0.5), osd(2, 0.5)], 0, ratios)
    expect(r.movedBytes).toBe(0)
    expect(r.receivers).toBe(2)
    expect(r.overNearfull).toBe(false)
    expect(r.overFull).toBe(false)
  })

  it('returns an empty impact for an unknown target', () => {
    const r = osdOutImpact([osd(0, 0.3)], 9, ratios)
    expect(r.movedBytes).toBe(0)
    expect(r.receivers).toBe(0)
    expect(r.overFull).toBe(false)
  })
})

describe('osdOutImpact same-host first', () => {
  const grid = (ratio = 0.6) => [0, 1, 2].flatMap(h => [0, 1, 2, 3].map(k => osd(h * 4 + k, ratio, { host: `pve${h + 1}` })))

  it('3 hosts x 4 OSD at 60 %: the 3 other OSD of the host go to 80 %', () => {
    const r = osdOutImpact(grid(), 0, ratios)

    expect(r.receivers).toBe(3)
    expect(r.maxProjectedRatio).toBeCloseTo(0.8)
    expect(r.overNearfull).toBe(false)
    expect([1, 2, 3]).toContain(r.maxProjectedOsd)
  })

  it('3 hosts x 1 OSD: spreads over the other hosts as before', () => {
    const r = osdOutImpact([0, 1, 2].map(i => osd(i, 0.6, { host: `pve${i + 1}` })), 0, ratios)

    expect(r.receivers).toBe(2)
    expect(r.maxProjectedRatio).toBeCloseTo(0.9)
    expect(r.overNearfull).toBe(true)
  })

  it('flags the estimate as unknown when the load of the OSD is not known', () => {
    expect(osdOutImpact([osd(0, 0.5, { loadKnown: false }), osd(1, 0.5)], 0, ratios).unknown).toBe(true)
    expect(osdOutImpact([osd(0, 0.5), osd(1, 0.5)], 0, ratios).unknown).toBe(false)
    expect(osdOutImpact([osd(0, 0.5, { loadKnown: false, in: false }), osd(1, 0.5)], 0, ratios).unknown).toBe(false)
  })
})
