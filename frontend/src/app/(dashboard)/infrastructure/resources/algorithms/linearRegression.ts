export function linearRegression(data: number[]): { slope: number; intercept: number; predict: (x: number) => number } {
  const n = data.length

  if (n < 2) {
    const avg = data.length > 0 ? data[0] : 0
    return { slope: 0, intercept: avg, predict: () => avg }
  }

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0

  for (let i = 0; i < n; i++) {
    sumX += i
    sumY += data[i]
    sumXY += i * data[i]
    sumX2 += i * i
  }

  const meanX = sumX / n
  const meanY = sumY / n

  const slope = (sumXY - n * meanX * meanY) / (sumX2 - n * meanX * meanX || 1)
  const intercept = meanY - slope * meanX

  const predict = (x: number): number => {
    return Math.max(0, Math.min(100, intercept + slope * x))
  }

  return { slope, intercept, predict }
}

export function calculateStdDev(data: number[], predict: (x: number) => number): number {
  if (data.length < 2) return 0
  const residuals = data.map((val, i) => val - predict(i))
  const mean = residuals.reduce((a, b) => a + b, 0) / residuals.length
  const variance = residuals.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / residuals.length
  return Math.sqrt(variance)
}

export function detectTrendType(slope: number): 'stable' | 'linear' | 'accelerating' | 'decelerating' {
  if (Math.abs(slope) < 0.05) return 'stable'
  return 'linear'
}

export function findThresholdDayLinear(currentValue: number, slope: number, threshold: number, maxDays: number = 180): number | null {
  if (slope <= 0) return null
  if (currentValue >= threshold) return 0

  const daysToThreshold = (threshold - currentValue) / slope

  if (daysToThreshold > 0 && daysToThreshold <= maxDays) {
    return Math.ceil(daysToThreshold)
  }

  return null
}
