import { describe, it, expect } from 'vitest'
import { getCrosswalk } from './crosswalk'

describe('getCrosswalk', () => {
  it('returns 800-53 control ids for the 800-53 framework', () => {
    expect(getCrosswalk('nist-800-53-r5').cluster_fw_enabled.controlIds).toEqual(['SC-7'])
  })

  it('returns 800-171 requirement ids for the 800-171 framework', () => {
    expect(getCrosswalk('nist-800-171-r2').cluster_fw_enabled.controlIds).toEqual(['3.13.1', '3.13.5'])
  })

  it('derives CMMC practice ids from the 800-171 column', () => {
    expect(getCrosswalk('cmmc-l2').cluster_fw_enabled.controlIds).toEqual(['SC.L2-3.13.1', 'SC.L2-3.13.5'])
  })

  it('returns Annex A control ids for ISO 27001', () => {
    expect(getCrosswalk('iso-27001-2022').cluster_fw_enabled.controlIds).toEqual(['A.8.20', 'A.8.22'])
  })

  it('rejects an unknown framework id instead of falling back to CMMC', () => {
    // Regression guard: the previous implementation ended in a bare else that
    // returned CMMC mappings for any unrecognised id.
    expect(() => getCrosswalk('not-a-framework' as never)).toThrow(/unknown framework/i)
  })

  it('carries a rationale for every mapped check on every framework', () => {
    for (const id of ['nist-800-53-r5', 'nist-800-171-r2', 'cmmc-l2', 'iso-27001-2022'] as const) {
      for (const m of Object.values(getCrosswalk(id))) {
        expect(m.rationale.trim().length).toBeGreaterThan(0)
      }
    }
  })
})
