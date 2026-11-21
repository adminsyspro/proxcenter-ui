import { describe, it, expect } from 'vitest'
import { getCrosswalk } from './crosswalk'
import { FRAMEWORK_IDS } from './types'

describe('getCrosswalk', () => {
  it('returns 800-53 control ids for the 800-53 framework', () => {
    expect(getCrosswalk('nist-800-53-r5').cluster_fw_enabled.controlIds).toEqual(['SC-7'])
  })

  it('returns Rev 3 requirement ids for the 800-171 framework', () => {
    // 3.13.5 (public subnetworks) was folded into 03.13.01 by Rev 3.
    expect(getCrosswalk('nist-800-171-r3').cluster_fw_enabled.controlIds).toEqual(['03.13.01'])
  })

  it('maps the Rev 2 requirements Rev 3 withdrew onto the requirement that absorbed them', () => {
    const cw = getCrosswalk('nist-800-171-r3')
    expect(cw.os_disk_encryption.controlIds).toEqual(['03.13.08'])
    expect(cw.no_default_tokens.controlIds).toEqual(['03.05.12'])
    expect(cw.ssh_root_login.controlIds).toEqual(['03.01.02', '03.01.06'])
  })

  it('leaves unmapped on Rev 3 only the checks that prove no requirement', () => {
    // A backup or replication job existing says nothing about backup
    // confidentiality (03.08.09), which only backup_encryption can show.
    const cw = getCrosswalk('nist-800-171-r3')
    const unmapped = Object.entries(cw).filter(([, m]) => m.controlIds.length === 0).map(([k]) => k).sort()
    expect(unmapped).toEqual(['backup_schedule', 'storage_replication'])
  })

  it('scores backup confidentiality only from the backup encryption check', () => {
    expect(getCrosswalk('nist-800-171-r3').backup_encryption.controlIds).toEqual(['03.08.09'])
    expect(getCrosswalk('cmmc-l2').backup_encryption.controlIds).toEqual(['MP.L2-3.8.9'])
  })

  it('maps password lifetime to Rev 3 authenticator refresh, and to nothing in Rev 2', () => {
    expect(getCrosswalk('nist-800-171-r3').access_password_aging.controlIds).toEqual(['03.05.12'])
    expect(getCrosswalk('cmmc-l2').access_password_aging.controlIds).toEqual([])
  })

  it('leaves unmapped on CMMC only the checks Rev 2 has no requirement for', () => {
    const cw = getCrosswalk('cmmc-l2')
    const unmapped = Object.entries(cw).filter(([, m]) => m.controlIds.length === 0).map(([k]) => k).sort()
    expect(unmapped).toEqual(['access_password_aging', 'backup_schedule', 'storage_replication'])
  })

  it('keeps CMMC practice ids on the Rev 2 numbering', () => {
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
