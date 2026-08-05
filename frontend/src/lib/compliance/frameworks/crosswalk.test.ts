import { describe, it, expect } from 'vitest'
import { getCrosswalk } from './crosswalk'
import { FRAMEWORK_IDS } from './types'

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

  it('returns CIS Controls v8.1 safeguard ids for the CIS framework', () => {
    expect(getCrosswalk('cis-controls-v8-1').cluster_fw_enabled.controlIds).toEqual(['4.4', '13.4'])
  })

  it('rejects an unknown framework id instead of falling back to CMMC', () => {
    // Regression guard: the previous implementation ended in a bare else that
    // returned CMMC mappings for any unrecognised id.
    expect(() => getCrosswalk('not-a-framework' as never)).toThrow(/unknown framework/i)
  })

  it('carries a rationale for every mapped check on every framework', () => {
    for (const id of FRAMEWORK_IDS) {
      for (const m of Object.values(getCrosswalk(id))) {
        expect(m.rationale.trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('has exactly two deliberately unmapped checks for CIS', () => {
    const cw = getCrosswalk('cis-controls-v8-1')
    const unmapped = Object.entries(cw).filter(([, m]) => m.controlIds.length === 0).map(([k]) => k).sort()
    expect(unmapped).toEqual(['access_login_banner', 'vm_no_usb_passthrough'])
  })
})
