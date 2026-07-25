import { describe, it, expect } from 'vitest'
import {
  Features,
  EDITION_FEATURES,
  effectiveHasFeature,
  isEnterpriseEdition,
  optionDisplayName,
  OPTION_REGISTRY,
} from './features'

const enterprise = { licensed: true, expired: false, edition: 'enterprise' }

describe('effectiveHasFeature', () => {
  it('grants an edition feature to a licensed enterprise', () => {
    expect(effectiveHasFeature(enterprise, Features.DRS)).toBe(true)
  })
  it('denies AUTO_HA without the option, even on enterprise', () => {
    expect(effectiveHasFeature(enterprise, Features.AUTO_HA)).toBe(false)
  })
  it('grants AUTO_HA via options on enterprise', () => {
    expect(effectiveHasFeature({ ...enterprise, options: ['auto_ha'] }, Features.AUTO_HA)).toBe(true)
  })
  it('grants AUTO_HA via options on enterprise_plus', () => {
    expect(
      effectiveHasFeature(
        { licensed: true, expired: false, edition: 'enterprise_plus', options: ['auto_ha'] },
        Features.AUTO_HA,
      ),
    ).toBe(true)
  })
  it('denies options on a non-enterprise edition (defense in depth)', () => {
    expect(
      effectiveHasFeature(
        { licensed: true, expired: false, edition: 'community', options: ['auto_ha'] },
        Features.AUTO_HA,
      ),
    ).toBe(false)
  })
  it('denies everything when expired', () => {
    expect(effectiveHasFeature({ ...enterprise, expired: true, options: ['auto_ha'] }, Features.AUTO_HA)).toBe(false)
    expect(effectiveHasFeature({ ...enterprise, expired: true }, Features.DRS)).toBe(false)
  })
  it('denies everything when unlicensed, null or empty', () => {
    expect(effectiveHasFeature(null, Features.DRS)).toBe(false)
    expect(effectiveHasFeature(undefined, Features.AUTO_HA)).toBe(false)
    expect(effectiveHasFeature({}, Features.DRS)).toBe(false)
    expect(effectiveHasFeature({ licensed: false, edition: 'enterprise', options: ['auto_ha'] }, Features.AUTO_HA)).toBe(false)
  })
})

describe('registry and edition mapping invariants', () => {
  it('AUTO_HA belongs to NO edition feature list', () => {
    for (const [edition, list] of Object.entries(EDITION_FEATURES)) {
      expect(list.includes(Features.AUTO_HA), `AUTO_HA leaked into ${edition}`).toBe(false)
    }
  })
  it('isEnterpriseEdition matches both enterprise tiers only', () => {
    expect(isEnterpriseEdition('enterprise')).toBe(true)
    expect(isEnterpriseEdition('enterprise_plus')).toBe(true)
    expect(isEnterpriseEdition('community')).toBe(false)
    expect(isEnterpriseEdition(undefined)).toBe(false)
  })
  it('every registered option has display info; unknown ids fall back to the raw id', () => {
    expect(OPTION_REGISTRY.auto_ha.name).toBe('Auto-HA')
    expect(optionDisplayName('auto_ha')).toBe('Auto-HA')
    expect(optionDisplayName('mystery_cap')).toBe('mystery_cap')
  })
})
