import type { KpiData, ResourceTrend, PredictiveAlert, ResourceThresholds } from '../types'
import { DEFAULT_THRESHOLDS } from '../constants'
import { linearRegression, calculateStdDev, findThresholdDayLinear } from './linearRegression'

// Exponential Weighted Moving Average
function ewma(data: number[], alpha: number = 0.3): number[] {
  if (data.length === 0) return []
  const result = [data[0]]
  for (let i = 1; i < data.length; i++) {
    result.push(alpha * data[i] + (1 - alpha) * result[i - 1])
  }
  return result
}

// Detect weekly seasonality (variance by day of week)
function detectSeasonality(data: number[]): number[] | null {
  if (data.length < 14) return null // Need at least 2 weeks

  const byDow: number[][] = [[], [], [], [], [], [], []]

  for (let i = 0; i < data.length; i++) {
    byDow[i % 7].push(data[i])
  }

  const means = byDow.map(arr =>
    arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
  )

  const globalMean = data.reduce((a, b) => a + b, 0) / data.length
  const seasonalFactors = means.map(m => m - globalMean)

  // Only use seasonality if variance is significant
  const maxFactor = Math.max(...seasonalFactors.map(Math.abs))
  if (maxFactor < 1) return null

  return seasonalFactors
}

// Apply recency weighting: last 30 days get 3x weight
function applyRecencyWeighting(data: number[]): number[] {
  if (data.length <= 30) return data

  const weighted: number[] = []
  const recentStart = data.length - 30

  for (let i = 0; i < data.length; i++) {
    if (i >= recentStart) {
      weighted.push(data[i], data[i], data[i]) // 3x weight
    } else {
      weighted.push(data[i])
    }
  }

  return weighted
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
  const alerts: PredictiveAlert[] = []
  const projectedTrends: ResourceTrend[] = [...trends]

  const cpuHistory = trends.map(t => t.cpu).filter(v => v !== undefined && !isNaN(v))
  const ramHistory = trends.map(t => t.ram).filter(v => v !== undefined && !isNaN(v))
  const storageHistory = trends.map(t => t.storage).filter(v => v !== undefined && !isNaN(v))

  const currentStoragePct = kpis.storage.total > 0 ? (kpis.storage.used / kpis.storage.total) * 100 : 0

  const lastCpu = cpuHistory.length > 0 ? cpuHistory[cpuHistory.length - 1] : kpis.cpu.used
  const lastRam = ramHistory.length > 0 ? ramHistory[ramHistory.length - 1] : kpis.ram.used
  const lastStorage = storageHistory.length > 0 ? storageHistory[storageHistory.length - 1] : currentStoragePct

  // Fallback to linear if not enough data
  const useEwma = cpuHistory.length >= 14

  function predictSeries(history: number[], lastVal: number, minGrowthPerDay: number = 0) {
    if (history.length < 2) {
      return { predict: (_day: number) => lastVal, stdDev: 0, trendType: 'stable' as const }
    }

    if (useEwma) {
      // EWMA smoothed prediction with recency weighting
      const weighted = applyRecencyWeighting(history)
      const smoothed = ewma(weighted, 0.3)
      const seasonality = detectSeasonality(history)

      // Use linear regression on EWMA-smoothed data for trend extraction
      const reg = linearRegression(smoothed)
      const stdDev = calculateStdDev(smoothed, reg.predict)

      let slope = reg.slope
      if (slope < minGrowthPerDay && minGrowthPerDay > 0) slope = minGrowthPerDay

      const predict = (day: number) => {
        let val = lastVal + slope * day
        if (seasonality) {
          const dow = (new Date().getDay() + day) % 7
          val += seasonality[dow] * 0.5 // Dampen seasonal effect
        }
        return Math.max(0, Math.min(100, val))
      }

      const trendType = Math.abs(slope) < 0.05 ? 'stable' as const : 'linear' as const

      return { predict, stdDev, trendType, slope }
    } else {
      // Fallback: simple linear regression
      const reg = linearRegression(history)
      const stdDev = calculateStdDev(history, reg.predict)
      let slope = reg.slope
      if (slope < minGrowthPerDay && minGrowthPerDay > 0) slope = minGrowthPerDay

      const predict = (day: number) => Math.max(0, Math.min(100, lastVal + slope * day))
      const trendType = Math.abs(slope) < 0.05 ? 'stable' as const : 'linear' as const

      return { predict, stdDev, trendType, slope }
    }
  }

  const cpuPred = predictSeries(cpuHistory, lastCpu)
  const ramPred = predictSeries(ramHistory, lastRam, 0.5 / 30)
  const storagePred = predictSeries(storageHistory, lastStorage, 1.0 / 30)

  // Add projection start point
  if (projectedTrends.length > 0) {
    const lastIndex = projectedTrends.length - 1
    projectedTrends[lastIndex] = {
      ...projectedTrends[lastIndex],
      cpuProjection: lastCpu,
      ramProjection: lastRam,
      storageProjection: lastStorage,
    }
  }

  const lastDate = new Date()

  for (let i = 1; i <= projectionDays; i++) {
    const date = new Date(lastDate)
    date.setDate(date.getDate() + i)

    const confidenceFactor = 1 + (i / projectionDays) * 1.5

    projectedTrends.push({
      t: date.toLocaleDateString(dateLocale, { day: 'numeric', month: 'short' }),
      cpu: undefined as any,
      ram: undefined as any,
      storage: undefined as any,
      cpuProjection: cpuPred.predict(i),
      ramProjection: ramPred.predict(i),
      storageProjection: storagePred.predict(i),
      cpuMin: Math.max(0, cpuPred.predict(i) - cpuPred.stdDev * confidenceFactor),
      cpuMax: Math.min(100, cpuPred.predict(i) + cpuPred.stdDev * confidenceFactor),
      ramMin: Math.max(0, ramPred.predict(i) - ramPred.stdDev * confidenceFactor),
      ramMax: Math.min(100, ramPred.predict(i) + ramPred.stdDev * confidenceFactor),
      storageMin: Math.max(0, storagePred.predict(i) - storagePred.stdDev * confidenceFactor),
      storageMax: Math.min(100, storagePred.predict(i) + storagePred.stdDev * confidenceFactor),
    } as ResourceTrend)
  }

  // Generate alerts
  const makeAlert = (
    resource: 'cpu' | 'ram' | 'storage',
    pred: ReturnType<typeof predictSeries>,
    lastVal: number,
    threshold: number,
  ): PredictiveAlert => {
    const predicted30 = pred.predict(30)
    const slope = pred.slope || 0
    const daysTo = findThresholdDayLinear(lastVal, slope, threshold)
    const trendDir = slope > 0.05 ? 'up' as const : slope < -0.05 ? 'down' as const : 'stable' as const

    return {
      resource,
      currentValue: lastVal,
      predictedValue: predicted30,
      daysToThreshold: daysTo,
      threshold,
      trend: trendDir,
      severity: daysTo !== null && daysTo <= 14 ? 'critical' : daysTo !== null && daysTo <= 30 ? 'warning' : 'ok',
      trendType: pred.trendType,
      confidence: Math.max(0, 100 - pred.stdDev * 3),
    }
  }

  alerts.push(makeAlert('cpu', cpuPred, lastCpu, thresholds.cpu.critical))
  alerts.push(makeAlert('ram', ramPred, lastRam, thresholds.ram.critical))
  alerts.push(makeAlert('storage', storagePred, lastStorage, thresholds.storage.critical))

  return { projectedTrends, alerts }
}
