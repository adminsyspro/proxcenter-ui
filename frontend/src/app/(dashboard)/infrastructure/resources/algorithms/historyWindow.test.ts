import { describe, it, expect } from 'vitest'

import { DEFAULT_HISTORY_WINDOW_DAYS, HISTORY_WINDOW_DAYS, effectiveWindow, isHistoryWindowDays, isWindowUseful, sliceTrendsToWindow } from './historyWindow'
import { FORECAST_HORIZON_DAYS, findThresholdDayLinear } from './linearRegression'
import type { ResourceTrend } from '../types'

const series = (n: number): ResourceTrend[] => Array.from({ length: n }, (_, i) => ({ t: `d${i}`, cpu: i, ram: i }))

describe('sliceTrendsToWindow', () => {
  it('keeps the last N days and moves the period start back from its end', () => {
    const period = { start: '2025-10-31', end: '2026-10-31', daysCount: 366 }

    const { trends, period: sliced } = sliceTrendsToWindow(series(366), period, 90)

    expect(trends).toHaveLength(90)
    expect(trends[0].t).toBe('d276')
    expect(trends[89].t).toBe('d365')
    expect(sliced).toEqual({ start: '2026-08-03', end: '2026-10-31', daysCount: 90 })
  })

  it('crosses a year boundary in UTC', () => {
    const { period } = sliceTrendsToWindow(series(400), { start: '2025-01-01', end: '2026-02-04', daysCount: 400 }, 365)

    expect(period).toEqual({ start: '2025-02-05', end: '2026-02-04', daysCount: 365 })
  })

  it('returns the history untouched when it is shorter than the window', () => {
    const trends = series(120)
    const period = { start: '2026-07-04', end: '2026-10-31', daysCount: 120 }

    const result = sliceTrendsToWindow(trends, period, 365)

    expect(result.trends).toBe(trends)
    expect(result.period).toBe(period)
  })

  it('slices without a period end and keeps the period as is', () => {
    const result = sliceTrendsToWindow(series(200), null, 180)

    expect(result.trends).toHaveLength(180)
    expect(result.period).toBeNull()
  })
})

describe('history window values', () => {
  it('offers 90, 180 and 365 days and defaults to 180', () => {
    expect(HISTORY_WINDOW_DAYS).toEqual([90, 180, 365])
    expect(DEFAULT_HISTORY_WINDOW_DAYS).toBe(180)
    expect(isHistoryWindowDays(365)).toBe(true)
    expect(isHistoryWindowDays(30)).toBe(false)
    expect(isHistoryWindowDays('365')).toBe(false)
    expect(isHistoryWindowDays(Number.NaN)).toBe(false)
  })
})

describe('windows the history can fill', () => {
  const useful = (available: number) => HISTORY_WINDOW_DAYS.filter(d => isWindowUseful(d, available))

  it('offers only the shortest window that already holds a short history', () => {
    expect(useful(59)).toEqual([90])
    expect(useful(90)).toEqual([90])
    expect(useful(91)).toEqual([90, 180])
    expect(useful(200)).toEqual([90, 180, 365])
    expect(useful(366)).toEqual([90, 180, 365])
  })

  it('falls back to the widest useful window without forgetting the choice', () => {
    expect(effectiveWindow(365, 59)).toBe(90)
    expect(effectiveWindow(180, 120)).toBe(180)
    expect(effectiveWindow(365, 120)).toBe(180)
    expect(effectiveWindow(365, 300)).toBe(365)
    expect(effectiveWindow(90, 300)).toBe(90)
  })
})

describe('findThresholdDayLinear horizon', () => {
  it('reports a crossing up to a year ahead, not beyond', () => {
    expect(FORECAST_HORIZON_DAYS).toBe(365)
    expect(findThresholdDayLinear(50, 0.15, 90)).toBe(267)
    expect(findThresholdDayLinear(50, 0.1, 90)).toBeNull()
    expect(findThresholdDayLinear(50, 0.15, 90, 180)).toBeNull()
  })
})
