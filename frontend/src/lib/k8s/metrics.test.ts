import { describe, it, expect } from 'vitest'
import {
  MODERATE_UTIL, HIGH_UTIL, NODE_UTIL_LIMIT,
  pct, clusterUtilization, perNodeUtilization, sortNodesByUsage, utilizationColor, utilizationGradientColor, UTIL_GRADIENT_CSS, formatCores, formatBytes,
} from './metrics'
import type { NodeUtilization } from './types'

function n(name: string, cu: number, ca: number, mu: number, ma: number): NodeUtilization {
  return { name, cpuUsedMilli: cu, cpuAllocMilli: ca, memUsedBytes: mu, memAllocBytes: ma }
}

describe('constants', () => {
  it('are the agreed values', () => {
    expect([MODERATE_UTIL, HIGH_UTIL, NODE_UTIL_LIMIT]).toEqual([70, 90, 12])
  })
})

describe('pct', () => {
  it('rounds usage / allocatable to a percent', () => {
    expect(pct(50, 100)).toBe(50)
    expect(pct(1, 3)).toBe(33)
  })
  it('guards a zero or negative denominator', () => {
    expect(pct(10, 0)).toBe(0)
    expect(pct(10, -5)).toBe(0)
  })
  it('clamps over-allocated usage to 100', () => {
    expect(pct(1500, 1000)).toBe(100)
  })
})

describe('clusterUtilization', () => {
  it('sums used + allocatable across nodes then computes percentages', () => {
    const out = clusterUtilization([
      n('a', 1000, 4000, 2 * 1024 ** 3, 8 * 1024 ** 3),
      n('b', 1000, 4000, 2 * 1024 ** 3, 8 * 1024 ** 3),
    ])
    expect(out.cpuUsedMilli).toBe(2000)
    expect(out.cpuAllocMilli).toBe(8000)
    expect(out.cpuPct).toBe(25)
    expect(out.memPct).toBe(25)
  })
  it('is 0% for an empty list', () => {
    expect(clusterUtilization([])).toEqual({
      cpuPct: 0, memPct: 0, cpuUsedMilli: 0, cpuAllocMilli: 0, memUsedBytes: 0, memAllocBytes: 0,
    })
  })
})

describe('perNodeUtilization', () => {
  it('maps to percentages and sorts ascending by name', () => {
    const out = perNodeUtilization([
      n('node-b', 2000, 4000, 0, 1),
      n('node-a', 1000, 4000, 1024 ** 3, 2 * 1024 ** 3),
    ])
    expect(out.map(b => b.name)).toEqual(['node-a', 'node-b'])
    expect(out[0].cpuPct).toBe(25)
    expect(out[1].cpuPct).toBe(50)
    expect(out[0].memPct).toBe(50)
    expect(out[1].memPct).toBe(0)
  })
})

describe('utilizationColor', () => {
  it('greens below moderate, ambers the 70..90 band, reds above high', () => {
    expect(utilizationColor(0)).toBe('#4caf50')
    expect(utilizationColor(69)).toBe('#4caf50')
    expect(utilizationColor(70)).toBe('#ff9800')
    expect(utilizationColor(90)).toBe('#ff9800')
    expect(utilizationColor(91)).toBe('#f44336')
  })
})

describe('sortNodesByUsage', () => {
  it('orders by aggregate CPU%+RAM% descending, name breaks ties', () => {
    const out = sortNodesByUsage([
      { name: 'idle', cpuPct: 10, memPct: 10 },   // agg 20
      { name: 'busy', cpuPct: 80, memPct: 70 },   // agg 150
      { name: 'mid-b', cpuPct: 40, memPct: 40 },  // agg 80
      { name: 'mid-a', cpuPct: 30, memPct: 50 },  // agg 80 (tie -> name)
    ])
    expect(out.map(b => b.name)).toEqual(['busy', 'mid-a', 'mid-b', 'idle'])
  })
  it('does not mutate the input array', () => {
    const input = [{ name: 'a', cpuPct: 1, memPct: 1 }, { name: 'b', cpuPct: 9, memPct: 9 }]
    const before = input.map(b => b.name)
    sortNodesByUsage(input)
    expect(input.map(b => b.name)).toEqual(before)
  })
})

describe('utilizationGradientColor', () => {
  it('interpolates hue green(120)->red(0) with the value', () => {
    expect(utilizationGradientColor(0)).toBe('hsl(120, 70%, 45%)')
    expect(utilizationGradientColor(50)).toBe('hsl(60, 70%, 45%)')
    expect(utilizationGradientColor(100)).toBe('hsl(0, 70%, 45%)')
  })
  it('clamps out-of-range input', () => {
    expect(utilizationGradientColor(-20)).toBe('hsl(120, 70%, 45%)')
    expect(utilizationGradientColor(140)).toBe('hsl(0, 70%, 45%)')
  })
  it('exposes a matching green->red bar gradient', () => {
    expect(UTIL_GRADIENT_CSS).toContain('hsl(120,70%,45%)')
    expect(UTIL_GRADIENT_CSS).toContain('hsl(0,70%,45%)')
  })
})

describe('formatCores', () => {
  it('shows millicores under one core and decimal cores at/above one', () => {
    expect(formatCores(340)).toBe('340m')
    expect(formatCores(1000)).toBe('1.0')
    expect(formatCores(3400)).toBe('3.4')
    expect(formatCores(8000)).toBe('8.0')
  })
})

describe('formatBytes', () => {
  it('uses binary units', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(2 * 1024 ** 2)).toBe('2.0 MiB')
    expect(formatBytes(1024 ** 3)).toBe('1.0 GiB')
    expect(formatBytes(Math.round(5.4 * 1024 ** 3))).toBe('5.4 GiB')
  })
})
