/**
 * Decides which copy a connected-license critical bell item shows (D5, A8,
 * M6). Shared by the navbar's critical bell so its wording and day counts
 * track the same source of truth as the Settings > License panel, and so
 * the decision itself is unit-testable without rendering the navbar.
 */

import { leaseDaysLeft } from './leaseDays'
import { isMovedLicenseExpired } from './movedLicenseExpired'

export type NotificationMessage = { key: string; values?: Record<string, number> }

type HeldEntry = { license_id?: string | null; lost?: boolean; grace_until?: string | null }
type ConnectionLike = {
  status?: string | null
  held?: HeldEntry[] | null
  lease_warn?: boolean
  lease_days_remaining?: number
} | null | undefined
type LicenseStatusLike = { lease_error?: string | null; license_id?: string | null } | null | undefined

// Picks the moved-license, plain lease-expired, license-lost (with its
// grace days or the ended copy), or lease-ending-soon copy, or null when
// none applies. `portalReachable` gates the parts that need a live
// connection (a lease error this instance already knows about still shows
// its copy even offline; `licenseStatus` and `connection.held` may be
// stale but are still the best information available).
export function leaseNotificationMessage(
  licenseStatus: LicenseStatusLike,
  connection: ConnectionLike,
  portalReachable: boolean
): NotificationMessage | null {
  if (licenseStatus?.lease_error) {
    return {
      key: isMovedLicenseExpired(licenseStatus, connection) ? 'settings.licenseMovedExpiredTitle' : 'settings.licenseLeaseExpiredTitle'
    }
  }

  const lostHeld = portalReachable ? connection?.held?.find(h => h.lost) : undefined

  if (lostHeld) {
    // null means the grace period already ran out (A8): its own "ended"
    // copy, never "less than a day left".
    const days = leaseDaysLeft(lostHeld.grace_until)

    return days === null ? { key: 'license.licenseLostEnded' } : { key: 'license.licenseLost', values: { days } }
  }

  if (portalReachable && connection?.lease_warn) {
    return { key: 'license.leaseExpiring', values: { days: connection.lease_days_remaining } }
  }

  return null
}

// M6: a blocked (cloned) connection gets its own critical bell item, no day
// count, same gating as the other license items.
export function connectionClonedNotification(connection: ConnectionLike): NotificationMessage | null {
  return connection?.status === 'cloned' ? { key: 'license.connectionCloned' } : null
}
