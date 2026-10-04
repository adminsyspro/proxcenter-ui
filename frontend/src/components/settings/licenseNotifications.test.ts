import { describe, expect, it } from 'vitest'

import { connectionClonedNotification, leaseNotificationMessage } from './licenseNotifications'

describe('leaseNotificationMessage', () => {
  it('is null when nothing is wrong', () => {
    expect(leaseNotificationMessage({}, { held: [] }, true)).toBeNull()
  })

  it('is null when the portal is unreachable and there is no lease error already known', () => {
    expect(leaseNotificationMessage({}, { held: [{ license_id: 'lic-1', lost: true }], lease_warn: true, lease_days_remaining: 5 }, false)).toBeNull()
  })

  it('picks the moved-license copy when the lease error license is held elsewhere (D5)', () => {
    expect(leaseNotificationMessage(
      { lease_error: 'expired', license_id: 'lic-1' },
      { held: [{ license_id: 'lic-1', lost: true }] },
      true,
    )).toEqual({ key: 'settings.licenseMovedExpiredTitle' })
  })

  it('picks the plain lease-expired copy when the lease error license is not held elsewhere', () => {
    expect(leaseNotificationMessage(
      { lease_error: 'expired', license_id: 'lic-1' },
      { held: [] },
      true,
    )).toEqual({ key: 'settings.licenseLeaseExpiredTitle' })
  })

  it.each([0, 1, 2])('reports the license-lost copy with %i grace days left', days => {
    const now = Date.now()
    const graceUntil = new Date(now + days * 24 * 60 * 60 * 1000 + 60 * 60 * 1000).toISOString()

    expect(leaseNotificationMessage(
      {},
      { held: [{ license_id: 'lic-1', lost: true, grace_until: graceUntil }] },
      true,
    )).toEqual({ key: 'license.licenseLost', values: { days } })
  })

  it('reports the license-lost-ended copy once the grace period has run out', () => {
    expect(leaseNotificationMessage(
      {},
      { held: [{ license_id: 'lic-1', lost: true, grace_until: new Date(Date.now() - 1000).toISOString() }] },
      true,
    )).toEqual({ key: 'license.licenseLostEnded' })
  })

  it('reports the license-lost-ended copy when there is no grace date at all', () => {
    expect(leaseNotificationMessage(
      {},
      { held: [{ license_id: 'lic-1', lost: true }] },
      true,
    )).toEqual({ key: 'license.licenseLostEnded' })
  })

  it('reports the lease-ending countdown when nothing was lost but the lease warns', () => {
    expect(leaseNotificationMessage(
      {},
      { held: [], lease_warn: true, lease_days_remaining: 3 },
      true,
    )).toEqual({ key: 'license.leaseExpiring', values: { days: 3 } })
  })

  it('never shows the lease-ending countdown when the portal is unreachable', () => {
    expect(leaseNotificationMessage(
      {},
      { held: [], lease_warn: true, lease_days_remaining: 3 },
      false,
    )).toBeNull()
  })
})

describe('connectionClonedNotification', () => {
  it('is null for any status other than cloned', () => {
    expect(connectionClonedNotification({ status: 'connected' })).toBeNull()
    expect(connectionClonedNotification({ status: 'disconnected' })).toBeNull()
    expect(connectionClonedNotification(undefined)).toBeNull()
  })

  it('reports the connection-cloned copy when blocked', () => {
    expect(connectionClonedNotification({ status: 'cloned' })).toEqual({ key: 'license.connectionCloned' })
  })
})
