import { describe, expect, it } from 'vitest'

import { MAX_VM_NAME_AFFIX, replicaName, vmNameAffixError } from './replicaName'

// PVE's own check, from pve_verify_dns_name in PVE/JSONSchema.pm. The replica's
// config is written straight into the target's /etc/pve, so nothing there
// re-validates the name: whatever this module lets through has to be a name
// PVE would have accepted.
const pveDNSName = /^([A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?\.)*([A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)$/

describe('vmNameAffixError', () => {
  it('accepts an empty affix, which means the source name is kept', () => {
    expect(vmNameAffixError('', 'prefix')).toBeNull()
    expect(vmNameAffixError('', 'suffix')).toBeNull()
  })

  it('accepts the affixes the feature exists for', () => {
    expect(vmNameAffixError('DR-', 'prefix')).toBeNull()
    expect(vmNameAffixError('-DR', 'suffix')).toBeNull()
    expect(vmNameAffixError('dr2', 'prefix')).toBeNull()
  })

  it('refuses an affix that would leave the name on a hyphen', () => {
    expect(vmNameAffixError('-DR', 'prefix')).toBe('shape')
    expect(vmNameAffixError('DR-', 'suffix')).toBe('shape')
  })

  it.each(['_DR', 'DR site', 'DR.', 'éDR', 'DR/', 'DR_01'])('refuses %s, which is not a DNS name fragment', value => {
    expect(vmNameAffixError(value, 'prefix')).toBe('shape')
    expect(vmNameAffixError(value, 'suffix')).toBe('shape')
  })

  it('caps the length', () => {
    expect(vmNameAffixError('a'.repeat(MAX_VM_NAME_AFFIX), 'prefix')).toBeNull()
    expect(vmNameAffixError('a'.repeat(MAX_VM_NAME_AFFIX + 1), 'prefix')).toBe('tooLong')
  })
})

describe('replicaName', () => {
  it('wraps the source name', () => {
    expect(replicaName('web01', 'DR-', '-2')).toBe('DR-web01-2')
  })

  it('leaves a nameless guest nameless, the way the orchestrator does', () => {
    expect(replicaName('', 'DR-', '-DR')).toBe('')
  })

  it('only ever composes a name PVE would accept', () => {
    const sourceNames = ['web01', 'a', 'git-ia', 'srv.example.com', '0', 'x-1-y']
    const affixes = ['', 'DR', 'DR-', '-DR', 'dr2', '9', 'a-b-c']

    for (const prefix of affixes.filter(v => !vmNameAffixError(v, 'prefix'))) {
      for (const suffix of affixes.filter(v => !vmNameAffixError(v, 'suffix'))) {
        for (const name of sourceNames) {
          expect(pveDNSName.test(name)).toBe(true)
          expect(replicaName(name, prefix, suffix)).toMatch(pveDNSName)
        }
      }
    }
  })
})
