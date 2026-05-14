import { describe, expect, it } from 'vitest'

import { detectInsight } from './insights'

const base = { avgCpuPct: 50, avgMemPct: 60, runningRatio: 1, pue: 1.4, maxcpu: 4 }

describe('detectInsight', () => {
  it('returns null when nothing matches', () => {
    expect(detectInsight(base)).toBeNull()
  })

  it('detects idle_cpu when avg cpu < 10% and running ratio > 0.5', () => {
    const i = detectInsight({ ...base, avgCpuPct: 7, runningRatio: 0.9 })

    expect(i?.kind).toBe('idle_cpu')
    expect(i?.severity).toBe('warning')
    expect(i?.placeholders.cpu).toBe(7)
    expect(i?.placeholders.suggestedVcpus).toBe(2)
  })

  it('idle_cpu does not fire when running ratio <= 0.5 (mostly_stopped wins)', () => {
    const i = detectInsight({ ...base, avgCpuPct: 7, runningRatio: 0.2 })

    expect(i?.kind).toBe('mostly_stopped')
  })

  it('detects oversized_ram when avg mem < 30% and running ratio > 0.5', () => {
    const i = detectInsight({ ...base, avgMemPct: 25, runningRatio: 0.9 })

    expect(i?.kind).toBe('oversized_ram')
    expect(i?.severity).toBe('warning')
    expect(i?.placeholders.memPct).toBe(25)
  })

  it('idle_cpu wins over oversized_ram when both match', () => {
    const i = detectInsight({ ...base, avgCpuPct: 5, avgMemPct: 20, runningRatio: 0.9 })

    expect(i?.kind).toBe('idle_cpu')
  })

  it('detects mostly_stopped when running ratio < 0.3', () => {
    const i = detectInsight({ ...base, runningRatio: 0.2 })

    expect(i?.kind).toBe('mostly_stopped')
    expect(i?.severity).toBe('info')
    expect(i?.placeholders.offPct).toBe(80)
  })

  it('detects efficient_dc when pue <= 1.2', () => {
    const i = detectInsight({ ...base, pue: 1.15 })

    expect(i?.kind).toBe('efficient_dc')
    expect(i?.severity).toBe('success')
    expect(i?.placeholders.pue).toBe('1.15')
  })

  it('idle_cpu wins over efficient_dc when both match', () => {
    const i = detectInsight({ ...base, avgCpuPct: 5, runningRatio: 0.9, pue: 1.1 })

    expect(i?.kind).toBe('idle_cpu')
  })

  it('suggestedVcpus is at least 1', () => {
    const i = detectInsight({ ...base, avgCpuPct: 5, runningRatio: 0.9, maxcpu: 1 })

    expect(i?.placeholders.suggestedVcpus).toBe(1)
  })

  it('suggestedVcpus rounds up from 40% of maxcpu', () => {
    const i = detectInsight({ ...base, avgCpuPct: 5, runningRatio: 0.9, maxcpu: 8 })

    expect(i?.placeholders.suggestedVcpus).toBe(4)
  })
})
