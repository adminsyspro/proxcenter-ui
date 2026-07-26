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
  it('denies HA without the option, even on enterprise', () => {
    expect(effectiveHasFeature(enterprise, Features.HA)).toBe(false)
  })
  it('grants HA via options on enterprise', () => {
    expect(effectiveHasFeature({ ...enterprise, options: ['control_plane_ha'] }, Features.HA)).toBe(true)
  })
  it('grants HA via options on enterprise_plus', () => {
    expect(
      effectiveHasFeature(
        { licensed: true, expired: false, edition: 'enterprise_plus', options: ['control_plane_ha'] },
        Features.HA,
      ),
    ).toBe(true)
  })
  it('denies options on a non-enterprise edition (defense in depth)', () => {
    expect(
      effectiveHasFeature(
        { licensed: true, expired: false, edition: 'community', options: ['control_plane_ha'] },
        Features.HA,
      ),
    ).toBe(false)
  })
  it('denies everything when expired', () => {
    expect(effectiveHasFeature({ ...enterprise, expired: true, options: ['control_plane_ha'] }, Features.HA)).toBe(false)
    expect(effectiveHasFeature({ ...enterprise, expired: true }, Features.DRS)).toBe(false)
  })
  it('denies everything when unlicensed, null or empty', () => {
    expect(effectiveHasFeature(null, Features.DRS)).toBe(false)
    expect(effectiveHasFeature(undefined, Features.HA)).toBe(false)
    expect(effectiveHasFeature({}, Features.DRS)).toBe(false)
    expect(effectiveHasFeature({ licensed: false, edition: 'enterprise', options: ['control_plane_ha'] }, Features.HA)).toBe(false)
  })
})

describe('registry and edition mapping invariants', () => {
  it('HA is the control_plane_ha option capability', () => {
    expect(Features.HA).toBe('control_plane_ha')
  })
  it('HA belongs to NO edition feature list', () => {
    for (const [edition, list] of Object.entries(EDITION_FEATURES)) {
      expect(list.includes(Features.HA), `HA leaked into ${edition}`).toBe(false)
    }
  })
  it('isEnterpriseEdition matches both enterprise tiers only', () => {
    expect(isEnterpriseEdition('enterprise')).toBe(true)
    expect(isEnterpriseEdition('enterprise_plus')).toBe(true)
    expect(isEnterpriseEdition('community')).toBe(false)
    expect(isEnterpriseEdition(undefined)).toBe(false)
  })
  it('every registered option has display info; unknown ids fall back to the raw id', () => {
    expect(OPTION_REGISTRY.control_plane_ha.name).toBe('ProxCenter HA')
    expect(optionDisplayName('control_plane_ha')).toBe('ProxCenter HA')
    expect(optionDisplayName('mystery_cap')).toBe('mystery_cap')
  })
})
