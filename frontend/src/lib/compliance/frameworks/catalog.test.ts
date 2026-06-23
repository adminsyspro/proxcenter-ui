import { describe, it, expect } from 'vitest'
import { NIST_800_171_R2_CONTROLS } from './catalog.nist-800-171-r2'
import { NIST_800_53_R5_CONTROLS } from './catalog.nist-800-53-r5'
import { CMMC_L2_CONTROLS } from './catalog.cmmc-l2'

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
