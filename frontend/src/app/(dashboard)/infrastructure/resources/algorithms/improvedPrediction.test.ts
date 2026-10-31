import { describe, expect, it } from 'vitest'

import type { KpiData, ResourceTrend } from '../types'
import { calculateImprovedPredictions, measuredForecastError, weightedLinearRegression } from './improvedPrediction'

const thresholds = { cpu: { warning: 80, critical: 90 }, ram: { warning: 80, critical: 90 }, storage: { warning: 80, critical: 90 } }

const kpis: KpiData = {
  cpu: { used: 10, allocated: 0, total: 0, trend: 0 },
  ram: { used: 50, allocated: 0, total: 0, trend: 0 },
  storage: { used: 50, total: 100, trend: 0 },
  vms: { total: 0, running: 0, stopped: 0 },
  efficiency: 0,
}

/** One point per day ending on 2026-10-30, a Friday. */
function series(values: { cpu: number[]; ram?: number[]; storage?: number[] }): ResourceTrend[] {
  const end = Date.UTC(2026, 9, 30)

  return values.cpu.map((cpu, i) => {
    const d = new Date(end - (values.cpu.length - 1 - i) * 86_400_000).toISOString().slice(0, 10)

    return { t: d, d, cpu, ram: values.ram?.[i] ?? 50, storage: values.storage?.[i] ?? 50 }
  })
}

const flat = (n: number, v: number) => Array.from({ length: n }, () => v)
const alertOf = (result: ReturnType<typeof calculateImprovedPredictions>, resource: string) => result.alerts.find(a => a.resource === resource)!

describe('weightedLinearRegression', () => {
  it('fits an exact line whatever the weights', () => {
    const fit = weightedLinearRegression([1, 3, 5, 7], [1, 1, 3, 3])

    expect(fit.slope).toBeCloseTo(2)
    expect(fit.intercept).toBeCloseTo(1)
  })
})

describe('calculateImprovedPredictions', () => {
  it('keeps a flat resource flat, with no crossing date (no forced growth)', () => {
    const result = calculateImprovedPredictions(kpis, series({ cpu: flat(90, 10), ram: flat(90, 60), storage: flat(90, 80) }), thresholds)

    for (const resource of ['cpu', 'ram', 'storage']) {
      expect(alertOf(result, resource)).toMatchObject({ daysToThreshold: null, trend: 'stable', trendType: 'stable' })
    }
    expect(alertOf(result, 'storage').predictedValue).toBeCloseTo(80)
  })

  it('follows a steady rise and dates the crossing from it', () => {
    const ram = Array.from({ length: 90 }, (_, i) => 30 + i * 0.5)
    const alert = alertOf(calculateImprovedPredictions(kpis, series({ cpu: flat(90, 10), ram }), thresholds), 'ram')

    expect(alert.currentValue).toBeCloseTo(74.5, 0)
    expect(alert.predictedValue).toBeCloseTo(89.5, 0)
    expect(alert.daysToThreshold).toBeGreaterThanOrEqual(30)
    expect(alert.daysToThreshold).toBeLessThanOrEqual(32)
  })

  it('does not let a one-day spike move the whole forecast', () => {
    const cpu = [...flat(89, 5), 13]
    const result = calculateImprovedPredictions(kpis, series({ cpu }), thresholds)
    const alert = alertOf(result, 'cpu')

    expect(alert.currentValue).toBeLessThan(10)
    expect(result.projectedTrends.at(-1)!.cpuProjection).toBeLessThan(10)
  })

  it('weights the last 30 days without stretching time', () => {
    // Flat for 60 days, then +1 point a day for 30 days.
    const ram = [...flat(60, 40), ...Array.from({ length: 30 }, (_, i) => 41 + i)]
    const alert = alertOf(calculateImprovedPredictions(kpis, series({ cpu: flat(90, 10), ram }), thresholds), 'ram')

    // One line over 90 days: unweighted it gives 0.27 a day, the old repeated
    // points 0.22; weighting the last 30 days 3 to 1 brings it closer to the recent pace.
    expect((alert.predictedValue - alert.currentValue) / 30).toBeGreaterThan(0.27)
  })

  it('puts the weekly pattern on the real weekdays', () => {
    // +6 points every Monday, 0 otherwise.
    const trends = series({ cpu: flat(84, 20) }).map(p => ({ ...p, cpu: new Date(`${p.d}T00:00:00Z`).getUTCDay() === 1 ? 26 : 20 }))
    const projected = calculateImprovedPredictions(kpis, trends, thresholds).projectedTrends.filter(p => p.cpu === undefined)

    // Day 1 after Friday 30 Oct is Saturday, day 3 is Monday 2 Nov.
    expect(projected[2].cpuProjection!).toBeGreaterThan(projected[0].cpuProjection! + 2)
  })

  it('follows a step that holds, unlike a spike', () => {
    const storage = [...flat(87, 45), 60, 60, 60]
    const alert = alertOf(calculateImprovedPredictions(kpis, series({ cpu: flat(90, 10), storage }), thresholds), 'storage')

    expect(alert.currentValue).toBeGreaterThan(59)
  })

  it('counts a resource already over its threshold on the last day as crossed', () => {
    const storage = [...flat(89, 85), 92]
    const alert = alertOf(calculateImprovedPredictions(kpis, series({ cpu: flat(90, 10), storage }), thresholds), 'storage')

    expect(alert.daysToThreshold).toBe(0)
  })

  it('starts the projection the day after the last point', () => {
    const result = calculateImprovedPredictions(kpis, series({ cpu: flat(20, 10) }), thresholds, 30, 'en-GB')
    const firstProjected = result.projectedTrends[20]

    expect(firstProjected.t).toBe('31 Oct')
  })
})

describe('measuredForecastError', () => {
  const days = (n: number) => series({ cpu: flat(n, 0) }).map(p => p.d)

  it('is about zero on a series the method follows exactly', () => {
    expect(measuredForecastError(flat(60, 40), days(60))).toBeCloseTo(0)
  })

  it('reports what a step after the cut was missed by', () => {
    // Flat at 40, then 50 for the last 10 days: the reruns from 28, 21 and 14 days back miss it.
    const values = [...flat(50, 40), ...flat(10, 50)]
    const error = measuredForecastError(values, days(60))!

    expect(error).toBeGreaterThan(2)
    expect(error).toBeLessThan(10)
  })

  it('is null when the history cannot be cut and still fitted', () => {
    expect(measuredForecastError(flat(27, 40), days(27))).toBeNull()
  })

  it('reaches every alert', () => {
    const result = calculateImprovedPredictions(kpis, series({ cpu: flat(60, 10) }), thresholds)

    expect(result.alerts.map(a => a.forecastError)).toEqual([expect.closeTo(0), expect.closeTo(0), expect.closeTo(0)])
  })
})
