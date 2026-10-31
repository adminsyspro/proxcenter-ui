import type { KpiData, ResourceTrend, PredictiveAlert, ResourceThresholds } from '../types'
import { DEFAULT_THRESHOLDS } from '../constants'
import { findThresholdDayLinear } from './linearRegression'

/*
 * 30-day capacity forecast of the resources page, from daily averages.
 *
 * - Slope: least squares on the smoothed series, the last 30 days weighted 3 to 1
 *   by real weights (not by repeating points, which stretched the time axis and
 *   cut the recent slope by about three).
 * - Starting level: the median of the last three days, not the last raw day, so a
 *   one-day spike or a partial day does not shift the whole forecast.
 * - Weekly pattern: by the real weekday of each point (`d`), half its amplitude.
 * - No growth is forced: a flat resource stays flat and gets no crossing date.
 * - Measured error: the same method rerun from a few past days and compared with
 *   what followed, shown instead of a fit statistic. On the lab series neither a
 *   language model, an automatic choice between methods nor an average of methods
 *   beat this one consistently, so it stays the only method.
 */

const TREND_ALPHA = 0.3
const RECENT_DAYS = 30
const RECENT_WEIGHT = 3
const MIN_SEASONAL_POINTS = 14
const STABLE_SLOPE = 0.05
const BACKTEST_HORIZON = 14
const BACKTEST_ORIGINS = [28, 21, 14]
const MIN_FIT_POINTS = 14

function ewma(data: number[], alpha: number): number[] {
  if (data.length === 0) return []
  const result = [data[0]]
  for (let i = 1; i < data.length; i++) result.push(alpha * data[i] + (1 - alpha) * result[i - 1])

  return result
}

/** Least squares with one weight per point, x being the day index. */
export function weightedLinearRegression(values: number[], weights: number[]): { slope: number; intercept: number } {
  let sw = 0, sx = 0, sy = 0
  for (let i = 0; i < values.length; i++) {
    sw += weights[i]
    sx += weights[i] * i
    sy += weights[i] * values[i]
  }
  if (sw === 0) return { slope: 0, intercept: 0 }

  const mx = sx / sw
  const my = sy / sw
  let sxy = 0, sxx = 0
  for (let i = 0; i < values.length; i++) {
    sxy += weights[i] * (i - mx) * (values[i] - my)
    sxx += weights[i] * (i - mx) * (i - mx)
  }
  const slope = sxx > 0 ? sxy / sxx : 0

  return { slope, intercept: my - slope * mx }
}

const weekday = (isoDay: string) => new Date(`${isoDay}T00:00:00Z`).getUTCDay()

/**
 * Mean residual per real weekday, or null without a date on every point, under
 * two weeks of data, or when the pattern stays under one point.
 */
function weeklyPattern(residuals: number[], days: Array<string | undefined>): number[] | null {
  if (residuals.length < MIN_SEASONAL_POINTS || days.some(d => !d)) return null

  const byDay: number[][] = [[], [], [], [], [], [], []]
  residuals.forEach((r, i) => byDay[weekday(days[i]!)].push(r))
  const factors = byDay.map(list => (list.length > 0 ? list.reduce((a, b) => a + b, 0) / list.length : 0))

  return Math.max(...factors.map(Math.abs)) < 1 ? null : factors
}

type SeriesForecast = {
  level: number
  slope: number
  stdDev: number
  trendType: 'stable' | 'linear'
  predict: (day: number) => number
}

function forecastSeries(history: number[], days: Array<string | undefined>, fallback: number, lastDay: Date): SeriesForecast {
  if (history.length < 2) {
    const level = history[0] ?? fallback

    return { level, slope: 0, stdDev: 0, trendType: 'stable', predict: () => level }
  }

  const smoothed = ewma(history, TREND_ALPHA)
  const weights = history.map((_, i) => (i >= history.length - RECENT_DAYS ? RECENT_WEIGHT : 1))
  const { slope, intercept } = weightedLinearRegression(smoothed, weights)
  const residuals = smoothed.map((v, i) => v - (intercept + slope * i))
  const stdDev = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / residuals.length)

  // Median of the last three days: a one-day spike or a partial day is ignored, a
  // step that holds two days (disks added, guests moved in) is followed at once.
  // The median sits one day back on a steady trend: add that day.
  const lastThree = history.slice(-3).sort((a, b) => a - b)
  const level = Math.max(0, Math.min(100, lastThree[Math.floor(lastThree.length / 2)] + slope))
  const season = weeklyPattern(history.map((v, i) => v - (intercept + slope * i)), days)

  const predict = (day: number) => {
    let value = level + slope * day
    if (season) {
      const date = new Date(lastDay)
      date.setUTCDate(date.getUTCDate() + day)
      value += season[date.getUTCDay()] * 0.5
    }

    return Math.max(0, Math.min(100, value))
  }

  return { level, slope, stdDev, trendType: Math.abs(slope) < STABLE_SLOPE ? 'stable' : 'linear', predict }
}

function trendOf(slope: number): PredictiveAlert['trend'] {
  if (slope > STABLE_SLOPE) return 'up'
  if (slope < -STABLE_SLOPE) return 'down'

  return 'stable'
}

function severityOf(daysTo: number | null): PredictiveAlert['severity'] {
  if (daysTo === null || daysTo > 30) return 'ok'

  return daysTo <= 14 ? 'critical' : 'warning'
}

const dayOf = (isoDay: string | undefined) => (isoDay ? new Date(`${isoDay}T00:00:00Z`) : new Date())

/**
 * Mean absolute error, in points, of this method over the next 14 days, measured
 * by forecasting from 28, 21 and 14 days back and comparing with what followed.
 * Null when the history is too short to rerun it at least once.
 */
export function measuredForecastError(history: number[], days: Array<string | undefined>): number | null {
  const errors: number[] = []
  for (const back of BACKTEST_ORIGINS) {
    const cut = history.length - back
    if (cut < MIN_FIT_POINTS) continue

    const pred = forecastSeries(history.slice(0, cut), days.slice(0, cut), history[cut - 1], dayOf(days[cut - 1]))
    const actual = history.slice(cut, cut + BACKTEST_HORIZON)
    errors.push(actual.reduce((sum, value, i) => sum + Math.abs(value - pred.predict(i + 1)), 0) / actual.length)
  }

  return errors.length > 0 ? errors.reduce((a, b) => a + b, 0) / errors.length : null
}

export function calculateImprovedPredictions(
  kpis: KpiData,
  trends: ResourceTrend[],
  thresholds: ResourceThresholds = DEFAULT_THRESHOLDS,
  projectionDays: number = 30,
  dateLocale: string = 'en-US',
): {
  projectedTrends: ResourceTrend[]
  alerts: PredictiveAlert[]
} {
  const projectedTrends: ResourceTrend[] = [...trends]
  const usable = (v: number | undefined): v is number => v !== undefined && !Number.isNaN(v)

  const series = (pick: (t: ResourceTrend) => number | undefined) => {
    const points = trends.filter(t => usable(pick(t)))

    return { values: points.map(t => pick(t) as number), days: points.map(t => t.d) }
  }
  const cpu = series(t => t.cpu)
  const ram = series(t => t.ram)
  const storage = series(t => t.storage)
  const currentStoragePct = kpis.storage.total > 0 ? (kpis.storage.used / kpis.storage.total) * 100 : 0

  // The forecast runs from the day after the last point, today without dates.
  const lastIso = trends.at(-1)?.d
  const lastDay = dayOf(lastIso)

  const cpuPred = forecastSeries(cpu.values, cpu.days, kpis.cpu.used, lastDay)
  const ramPred = forecastSeries(ram.values, ram.days, kpis.ram.used, lastDay)
  const storagePred = forecastSeries(storage.values, storage.days, currentStoragePct, lastDay)

  if (projectedTrends.length > 0) {
    const lastIndex = projectedTrends.length - 1
    projectedTrends[lastIndex] = {
      ...projectedTrends[lastIndex],
      cpuProjection: cpuPred.level,
      ramProjection: ramPred.level,
      storageProjection: storagePred.level,
    }
  }

  for (let i = 1; i <= projectionDays; i++) {
    const date = new Date(lastDay)
    date.setUTCDate(date.getUTCDate() + i)
    const spread = 1 + (i / projectionDays) * 1.5
    const band = (pred: SeriesForecast) => ({
      min: Math.max(0, pred.predict(i) - pred.stdDev * spread),
      max: Math.min(100, pred.predict(i) + pred.stdDev * spread),
    })

    projectedTrends.push({
      t: date.toLocaleDateString(dateLocale, { day: 'numeric', month: 'short', timeZone: lastIso ? 'UTC' : undefined }),
      cpu: undefined as any,
      ram: undefined as any,
      storage: undefined as any,
      cpuProjection: cpuPred.predict(i),
      ramProjection: ramPred.predict(i),
      storageProjection: storagePred.predict(i),
      cpuMin: band(cpuPred).min,
      cpuMax: band(cpuPred).max,
      ramMin: band(ramPred).min,
      ramMax: band(ramPred).max,
      storageMin: band(storagePred).min,
      storageMax: band(storagePred).max,
    } as ResourceTrend)
  }

  const makeAlert = (resource: 'cpu' | 'ram' | 'storage', pred: SeriesForecast, history: { values: number[]; days: Array<string | undefined> }, threshold: number): PredictiveAlert => {
    const lastValue = history.values.at(-1)
    // Already over on the last day counts as crossed even if the smoothed level is not yet.
    const daysTo = lastValue !== undefined && lastValue >= threshold ? 0 : findThresholdDayLinear(pred.level, pred.slope, threshold)

    return {
      resource,
      currentValue: pred.level,
      predictedValue: pred.predict(projectionDays),
      daysToThreshold: daysTo,
      threshold,
      trend: trendOf(pred.slope),
      severity: severityOf(daysTo),
      trendType: pred.trendType,
      confidence: Math.max(0, 100 - pred.stdDev * 3),
      forecastError: measuredForecastError(history.values, history.days),
    }
  }

  return {
    projectedTrends,
    alerts: [
      makeAlert('cpu', cpuPred, cpu, thresholds.cpu.critical),
      makeAlert('ram', ramPred, ram, thresholds.ram.critical),
      makeAlert('storage', storagePred, storage, thresholds.storage.critical),
    ],
  }
}
