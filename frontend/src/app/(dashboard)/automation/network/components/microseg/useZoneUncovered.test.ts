import { describe, expect, it } from 'vitest'

import type { MicrosegTraffic } from '@/lib/microseg/types'

import { mergeTraffic, uncoveredByZone, uncoveredSeriesByZone, uncoveredSeriesOf } from './useZoneUncovered'

const bucket = (at: string, zone: string, hits: number, verdict = 'would_block') => ({ at, zone, src_zone: '', verdict, hits })
const traffic = (buckets: MicrosegTraffic['buckets']): MicrosegTraffic => ({
  step: 3600, from: '2026-11-03T12:00:00Z', to: '2026-11-04T12:00:00Z', buckets,
})

describe('uncoveredSeriesByZone', () => {
  it('cuts the window in hourly buckets per destination zone, verdicts and sources together, case ignored', () => {
    const s = uncoveredSeriesByZone(traffic([
      bucket('2026-11-03T12:00:00Z', 'web', 4),
      bucket('2026-11-03T12:00:00Z', 'Web', 1, 'blocked'),
      bucket('2026-11-04T11:00:00Z', 'web', 7),
      bucket('2026-11-03T15:00:00Z', 'db', 2),
    ]))
    expect(s.size).toBe(24)
    expect(s.stepMs).toBe(3_600_000)
    expect(s.from).toBe(Date.parse('2026-11-03T12:00:00Z'))
    const web = s.byZone.get('web')!
    expect(web).toHaveLength(24)
    expect(web[0]).toBe(5)
    expect(web[23]).toBe(7)
    expect(web.reduce((a, b) => a + b, 0)).toBe(12)
    expect(s.byZone.get('db')![3]).toBe(2)
  })

  it('drops a bucket outside the window and a malformed date', () => {
    const s = uncoveredSeriesByZone(traffic([
      bucket('2026-11-03T11:00:00Z', 'web', 9),
      bucket('2026-11-04T12:00:00Z', 'web', 9),
      bucket('not a date', 'web', 9),
    ]))
    expect(s.byZone.size).toBe(0)
  })
})

describe('uncoveredSeriesOf', () => {
  const s = uncoveredSeriesByZone(traffic([bucket('2026-11-03T12:00:00Z', 'web', 3), bucket('2026-11-03T12:00:00Z', 'front', 2)]))

  it('gives a zone without traffic a flat series of the window size', () => {
    expect(uncoveredSeriesOf(s, 'cache')).toEqual(new Array(24).fill(0))
  })

  it('adds the series of the name the zone had in the applied revision', () => {
    expect(uncoveredSeriesOf(s, 'WEB')[0]).toBe(3)
    expect(uncoveredSeriesOf(s, 'web', 'front')[0]).toBe(5)
    expect(uncoveredSeriesOf(s, 'web', 'Web')[0]).toBe(3)
  })
})

describe('mergeTraffic', () => {
  it('sums the histories of the clusters of a shared policy by zone name', () => {
    const dr = traffic([bucket('2026-11-03T12:00:00Z', 'db', 2554)])
    const prod = traffic([bucket('2026-11-03T12:00:00Z', 'db', 737), bucket('2026-11-03T13:00:00Z', 'web', 107)])
    const merged = mergeTraffic([dr, prod])!
    expect(uncoveredByZone(merged).get('db')).toBe(3291)
    expect(uncoveredByZone(merged).get('web')).toBe(107)
    expect(uncoveredSeriesByZone(merged).byZone.get('db')![0]).toBe(3291)
  })

  it('keeps the window of the latest read and drops the buckets of an older read outside it', () => {
    const older = { ...traffic([bucket('2026-11-03T11:00:00Z', 'db', 9), bucket('2026-11-03T12:00:00Z', 'db', 1)]), from: '2026-11-03T11:00:00Z', to: '2026-11-04T11:00:00Z' }
    const latest = traffic([bucket('2026-11-04T11:00:00Z', 'db', 4)])
    const merged = mergeTraffic([older, latest])!
    expect(merged.from).toBe('2026-11-03T12:00:00Z')
    expect(uncoveredByZone(merged).get('db')).toBe(5)
  })

  it('keeps every bucket when the window cannot be read', () => {
    const blank = (buckets: MicrosegTraffic['buckets']) => ({ ...traffic(buckets), from: '', to: '' })
    const merged = mergeTraffic([blank([bucket('2026-11-03T12:00:00Z', 'db', 2)]), blank([bucket('2026-11-01T12:00:00Z', 'db', 3)])])!
    expect(uncoveredByZone(merged).get('db')).toBe(5)
  })

  it('is the answer itself for one cluster, and nothing without an answer', () => {
    const one = traffic([bucket('2026-11-03T12:00:00Z', 'db', 3)])
    expect(mergeTraffic([one])).toBe(one)
    expect(mergeTraffic([])).toBeNull()
  })
})
