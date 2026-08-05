import { describe, it, expect } from 'vitest'
import { NIST_800_171_R2_CONTROLS } from './catalog.nist-800-171-r2'
import { NIST_800_53_R5_CONTROLS } from './catalog.nist-800-53-r5'
import { CMMC_L2_CONTROLS } from './catalog.cmmc-l2'
import { CIS_CONTROLS_V8_1_CONTROLS } from './catalog.cis-controls-v8-1'

describe('generated catalogues', () => {
  it('800-171 r2 has the full 110 requirements', () => {
    expect(NIST_800_171_R2_CONTROLS.length).toBe(110)
    expect(NIST_800_171_R2_CONTROLS.every(c => /^3\.\d+\.\d+$/.test(c.id))).toBe(true)
  })
  it('CMMC L2 has 110 practices derived from 800-171', () => {
    expect(CMMC_L2_CONTROLS.length).toBe(110)
    expect(CMMC_L2_CONTROLS.every(c => /^[A-Z]{2}\.L2-3\.\d+\.\d+$/.test(c.id))).toBe(true)
  })
  it('800-53 r5 Moderate baseline is non-trivial and well-formed', () => {
    expect(NIST_800_53_R5_CONTROLS.length).toBeGreaterThan(150)
    expect(NIST_800_53_R5_CONTROLS.every(c => c.id && c.title && c.family)).toBe(true)
  })
})

describe('CIS Controls v8.1 catalogue', () => {
  const PER_CONTROL: Record<string, number> = {
    '01': 5, '02': 7, '03': 14, '04': 12, '05': 6, '06': 8, '07': 7, '08': 12, '09': 7,
    '10': 7, '11': 5, '12': 8, '13': 11, '14': 9, '15': 7, '16': 14, '17': 9, '18': 5,
  }

  it('has the full 153 safeguards', () => {
    expect(CIS_CONTROLS_V8_1_CONTROLS.length).toBe(153)
  })

  it('uses well-formed safeguard ids', () => {
    expect(CIS_CONTROLS_V8_1_CONTROLS.every(c => /^\d{1,2}\.\d{1,2}$/.test(c.id))).toBe(true)
    expect(new Set(CIS_CONTROLS_V8_1_CONTROLS.map(c => c.id)).size).toBe(153)
  })

  it('has a non-empty title for every safeguard', () => {
    expect(CIS_CONTROLS_V8_1_CONTROLS.every(c => c.title.trim().length > 0)).toBe(true)
  })

  it('groups safeguards into the 18 zero-padded parent controls', () => {
    const families = [...new Set(CIS_CONTROLS_V8_1_CONTROLS.map(c => c.family))]
    expect(families).toHaveLength(18)
    expect(families.every(f => /^\d{2} \S/.test(f))).toBe(true)
    // Zero padding must make lexicographic order match numeric order, because
    // assessFramework sorts families with localeCompare.
    expect([...families].sort((a, b) => a.localeCompare(b))).toEqual(families)
  })

  it('matches the published per-control safeguard distribution', () => {
    const counts: Record<string, number> = {}
    for (const c of CIS_CONTROLS_V8_1_CONTROLS) {
      const prefix = c.family.slice(0, 2)
      counts[prefix] = (counts[prefix] ?? 0) + 1
    }
    expect(counts).toEqual(PER_CONTROL)
  })

  it('keeps each safeguard in the family matching its id prefix', () => {
    for (const c of CIS_CONTROLS_V8_1_CONTROLS) {
      expect(c.family.slice(0, 2)).toBe(c.id.split('.')[0].padStart(2, '0'))
    }
  })

  it('has no irregular whitespace in titles or families', () => {
    for (const c of CIS_CONTROLS_V8_1_CONTROLS) {
      expect(c.title).toBe(c.title.replace(/\s+/g, ' ').trim())
      expect(c.family).toBe(c.family.replace(/\s+/g, ' ').trim())
    }
  })
})
