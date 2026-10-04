import { describe, expect, it } from 'vitest'

import { isMovedLicenseExpired } from './movedLicenseExpired'

describe('isMovedLicenseExpired', () => {
  it('is false when there is no lease error', () => {
    expect(isMovedLicenseExpired(
      { lease_error: null, license_id: 'lic-1' },
      { held: [{ license_id: 'lic-1', lost: true }] },
    )).toBe(false)
  })

  it('is false when the lease error license is not in the held list', () => {
    expect(isMovedLicenseExpired(
      { lease_error: 'expired', license_id: 'lic-1' },
      { held: [{ license_id: 'lic-2', lost: true }] },
    )).toBe(false)
  })

  it('is false when the held entry for that license is not lost', () => {
    expect(isMovedLicenseExpired(
      { lease_error: 'expired', license_id: 'lic-1' },
      { held: [{ license_id: 'lic-1', lost: false }] },
    )).toBe(false)
  })

  it('is true when the lease error license is held elsewhere (lost: true)', () => {
    expect(isMovedLicenseExpired(
      { lease_error: 'expired', license_id: 'lic-1' },
      { held: [{ license_id: 'lic-1', lost: true }] },
    )).toBe(true)
  })

  it('is false without a license_id on the status, even with a lease error', () => {
    expect(isMovedLicenseExpired(
      { lease_error: 'expired', license_id: null },
      { held: [{ license_id: 'lic-1', lost: true }] },
    )).toBe(false)
  })

  it('handles a missing connection or held list', () => {
    expect(isMovedLicenseExpired({ lease_error: 'expired', license_id: 'lic-1' }, null)).toBe(false)
    expect(isMovedLicenseExpired({ lease_error: 'expired', license_id: 'lic-1' }, {})).toBe(false)
    expect(isMovedLicenseExpired(null, { held: [{ license_id: 'lic-1', lost: true }] })).toBe(false)
  })
})
