import type { KpiData, ResourceTrend, PredictiveAlert, ResourceThresholds } from '../types'
import { DEFAULT_THRESHOLDS } from '../constants'
import { linearRegression, calculateStdDev, detectTrendType, findThresholdDayLinear } from './linearRegression'

export function calculatePredictions(
  kpis: KpiData,
  trends: ResourceTrend[],
  thresholds: ResourceThresholds = DEFAULT_THRESHOLDS,
  projectionDays: number = 30,
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

  if (cpuHistory.length < 2) {
    for (let i = cpuHistory.length; i < 2; i++) cpuHistory.unshift(lastCpu)
  }
  if (ramHistory.length < 2) {
    for (let i = ramHistory.length; i < 2; i++) ramHistory.unshift(lastRam)
  }
  if (storageHistory.length < 2) {
    for (let i = storageHistory.length; i < 2; i++) storageHistory.unshift(lastStorage)
  }

  const cpuRegression = linearRegression(cpuHistory)
  const ramRegression = linearRegression(ramHistory)
  const storageRegression = linearRegression(storageHistory)

  const cpuStdDev = calculateStdDev(cpuHistory, cpuRegression.predict)
  const ramStdDev = calculateStdDev(ramHistory, ramRegression.predict)
  const storageStdDev = calculateStdDev(storageHistory, storageRegression.predict)

  const cpuTrendType = detectTrendType(cpuRegression.slope)
  const ramTrendType = detectTrendType(ramRegression.slope)
  const storageTrendType = detectTrendType(storageRegression.slope)

  const lastDate = new Date()

  const MIN_RAM_GROWTH_PER_DAY = 0.5 / 30
  const MIN_STORAGE_GROWTH_PER_DAY = 1.0 / 30

  const cpuSlope = cpuRegression.slope
  const ramSlope = ramRegression.slope > MIN_RAM_GROWTH_PER_DAY ? ramRegression.slope : MIN_RAM_GROWTH_PER_DAY
  const storageSlope = storageRegression.slope > MIN_STORAGE_GROWTH_PER_DAY ? storageRegression.slope : MIN_STORAGE_GROWTH_PER_DAY

  if (projectedTrends.length > 0) {
    const lastIndex = projectedTrends.length - 1
    projectedTrends[lastIndex] = {
      ...projectedTrends[lastIndex],
      cpuProjection: lastCpu,
      ramProjection: lastRam,
      storageProjection: lastStorage,
    }
  }

  for (let i = 1; i <= projectionDays; i++) {
    const date = new Date(lastDate)
    date.setDate(date.getDate() + i)

    let projectedCpu = lastCpu + cpuSlope * i
    let projectedRam = lastRam + ramSlope * i
    let projectedStorage = lastStorage + storageSlope * i

    projectedCpu = Math.max(0, Math.min(100, projectedCpu))
    projectedRam = Math.max(0, Math.min(100, projectedRam))
    projectedStorage = Math.max(0, Math.min(100, projectedStorage))

    const confidenceFactor = 1 + (i / projectionDays) * 1.5

    projectedTrends.push({
      t: date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }),
      cpu: undefined as any,
      ram: undefined as any,
      storage: undefined as any,
      cpuProjection: projectedCpu,
      ramProjection: projectedRam,
      storageProjection: projectedStorage,
      cpuMin: Math.max(0, projectedCpu - cpuStdDev * confidenceFactor),
      cpuMax: Math.min(100, projectedCpu + cpuStdDev * confidenceFactor),
      ramMin: Math.max(0, projectedRam - ramStdDev * confidenceFactor),
      ramMax: Math.min(100, projectedRam + ramStdDev * confidenceFactor),
      storageMin: Math.max(0, projectedStorage - storageStdDev * confidenceFactor),
      storageMax: Math.min(100, projectedStorage + storageStdDev * confidenceFactor),
    } as ResourceTrend)
  }

  const predictLinear = (last: number, slope: number) => (day: number): number => {
    return Math.max(0, Math.min(100, last + slope * day))
  }

  // CPU Alert
  const cpuPredicted30 = predictLinear(lastCpu, cpuSlope)(30)
  const cpuDaysTo = findThresholdDayLinear(lastCpu, cpuSlope, thresholds.cpu.critical)
  const cpuTrendDirection = cpuSlope > 0.05 ? 'up' as const : cpuSlope < -0.05 ? 'down' as const : 'stable' as const

  alerts.push({
    resource: 'cpu',
    currentValue: lastCpu,
    predictedValue: cpuPredicted30,
    daysToThreshold: cpuDaysTo,
    threshold: thresholds.cpu.critical,
    trend: cpuTrendDirection,
    severity: cpuDaysTo !== null && cpuDaysTo <= 14 ? 'critical' : cpuDaysTo !== null && cpuDaysTo <= 30 ? 'warning' : 'ok',
    trendType: cpuTrendType,
    confidence: Math.max(0, 100 - cpuStdDev * 3),
  })

  // RAM Alert
  const ramPredicted30 = predictLinear(lastRam, ramSlope)(30)
  const ramDaysTo = findThresholdDayLinear(lastRam, ramSlope, thresholds.ram.critical)
  const ramTrendDirection = ramSlope > 0.05 ? 'up' as const : ramSlope < -0.05 ? 'down' as const : 'stable' as const

  alerts.push({
    resource: 'ram',
    currentValue: lastRam,
    predictedValue: ramPredicted30,
    daysToThreshold: ramDaysTo,
    threshold: thresholds.ram.critical,
    trend: ramTrendDirection,
    severity: ramDaysTo !== null && ramDaysTo <= 14 ? 'critical' : ramDaysTo !== null && ramDaysTo <= 30 ? 'warning' : 'ok',
    trendType: ramTrendType,
    confidence: Math.max(0, 100 - ramStdDev * 3),
  })

  // Storage Alert
  const storagePredicted30 = predictLinear(lastStorage, storageSlope)(30)
  const storageDaysTo = findThresholdDayLinear(lastStorage, storageSlope, thresholds.storage.critical)
  const storageTrendDirection = storageSlope > 0.05 ? 'up' as const : storageSlope < -0.05 ? 'down' as const : 'stable' as const

  alerts.push({
    resource: 'storage',
    currentValue: lastStorage,
    predictedValue: storagePredicted30,
    daysToThreshold: storageDaysTo,
    threshold: thresholds.storage.critical,
    trend: storageTrendDirection,
    severity: storageDaysTo !== null && storageDaysTo <= 14 ? 'critical' : storageDaysTo !== null && storageDaysTo <= 30 ? 'warning' : 'ok',
    trendType: storageTrendType,
    confidence: Math.max(0, 100 - storageStdDev * 3),
  })

  return { projectedTrends, alerts }
}
