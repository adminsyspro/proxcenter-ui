import { describe, expect, it } from 'vitest'

import type { VisibleSeries } from './metricsShared'
import { MAX_LINES, chartData, fleetLoad, fleetTrend, pressureOf, seriesLabel } from './pressure'

const T = { util_pct: 90, memory_pct: 90, temp_c: 85 }
const g = (over: Record<string, unknown> = {}) => ({ util: 10, mem_used: 1000, mem_total: 24000, temp: 40, power: 60, thermal_slow: false, power_slow: false, ...over })

describe('pressureOf', () => {
  it('flags saturation, memory, heat and throttling against the thresholds', () => {
    expect(pressureOf(g({ util: 95, mem_used: 23000, temp: 86, power_slow: true }), T)).toEqual({ saturated: true, memoryPressure: true, hot: true, throttled: true })
    expect(pressureOf(g(), T)).toEqual({ saturated: false, memoryPressure: false, hot: false, throttled: false })
    expect(pressureOf(g({ temp: 0, mem_total: 0 }), T).hot).toBe(false)
  })
})

describe('fleetLoad', () => {
  it('averages the load and sums the memory and power of the fleet', () => {
    const f = fleetLoad([g({ util: 100, mem_used: 24000 }), g({ util: 0, mem_used: 0, thermal_slow: true })], T)
    expect(f).toEqual(expect.objectContaining({ gpus: 2, avgUtil: 50, memoryUsed: 24000, memoryTotal: 48000, memoryPct: 50, power: 120, saturated: 1, memoryPressure: 1, throttled: 1, hotOrThrottled: 1 }))
  })

  it('counts a GPU both hot and slowed down once', () => {
    expect(fleetLoad([g({ temp: 90, power_slow: true })], T)).toEqual(expect.objectContaining({ hot: 1, throttled: 1, hotOrThrottled: 1 }))
  })

  it('reads zero for an empty fleet', () => {
    expect(fleetLoad([], T)).toEqual(expect.objectContaining({ gpus: 0, avgUtil: 0, memoryPct: 0 }))
  })
})

const series = (i: number, util: number, times = [0, 300]): VisibleSeries => ({
  deviceKey: `d${i}`, connectionName: 'PROD', node: 'n1', vmid: String(100 + i), vmName: `vm-${i}`, deviceName: 'L4',
  connectionId: 'c1', target: `vm:${100 + i}:GPU-${String(i).padStart(2, '0')}`,
  points: times.map(time => ({ time, util, util_max: util, mem_util: 0, mem_used: 12000, mem_used_max: 12000, mem_total: 24000, temp_max: 60, power: 100, power_max: 110, power_limit: 230, thermal_slow: 0, power_slow: 0 })),
})

describe('chartData', () => {
  it('gives one row per bucket of the range, gaps left empty', () => {
    const d = chartData([series(1, 40, [0])], 'util', 0, 900, 300, 'Others')
    expect(d.rows).toEqual([{ time: 0, s0: 40 }, { time: 300 }, { time: 600 }])
    expect(d.series).toEqual([{ key: 's0', label: 'vm-1 #101', colorIndex: 0 }])
  })

  it('converts memory to a share of the card', () => {
    expect(chartData([series(1, 40)], 'memory', 0, 300, 300, 'Others').rows[0].s0).toBe(50)
  })

  it('folds the least loaded GPUs into Others past the line cap, colours kept per GPU', () => {
    const all = Array.from({ length: MAX_LINES + 2 }, (_, i) => series(i, i * 10))
    const d = chartData(all, 'util', 0, 300, 300, 'Others')
    expect(d.series).toHaveLength(MAX_LINES)
    expect(d.series.at(-1)).toEqual({ key: 'others', label: 'Others (3)', colorIndex: null })
    // GPUs 0, 1, 2 (the least loaded) are folded: their average is 10.
    expect(d.rows[0].others).toBe(10)
    const nine = d.series.find(s => s.label.startsWith('vm-9 '))
    expect(nine?.colorIndex).toBe(9 % 8)
  })
})

describe('seriesLabel', () => {
  it('names a guest series by its VM and a host series by its node', () => {
    expect(seriesLabel({ vmName: 'ai', vmid: '9010', node: 'n1', deviceName: 'A5000' })).toBe('ai #9010')
    expect(seriesLabel({ vmName: null, vmid: null, node: 'n1', deviceName: 'A5000' })).toBe('n1 · A5000')
  })
})

describe('fleetTrend', () => {
  const pt = (time: number, util: number, used: number, power: number) => ({ time, util, util_max: util, mem_util: 0, mem_used: used, mem_used_max: used, mem_total: 1000, temp_max: 50, power, power_max: power, power_limit: 230, thermal_slow: 0, power_slow: 0 })
  const s = (target: string, deviceKey: string | null, points: ReturnType<typeof pt>[]) => ({ deviceKey, connectionName: 'L', node: 'n1', vmid: null, vmName: null, deviceName: 'A5000', connectionId: 'c1', target, points })

  it('averages the load, sums memory and power per bucket, one series per card, the host one first', () => {
    const trend = fleetTrend(
      [
        s('vm:9010:a', 'c1:n1:03', [pt(0, 50, 100, 0)]),
        s('node:n1:0000:03:00', 'c1:n1:03', [pt(0, 90, 400, 200), pt(300, 10, 100, 60)]),
        s('vm:9020:b', 'c1:n1:41', [pt(0, 30, 600, 70)]),
      ],
      0,
      900,
      300,
    )
    expect(trend).toEqual([
      { time: 0, util: 60, memory: 50, power: 270 },
      { time: 300, util: 10, memory: 10, power: 60 },
      { time: 600, util: null, memory: null, power: null },
    ])
  })
})
