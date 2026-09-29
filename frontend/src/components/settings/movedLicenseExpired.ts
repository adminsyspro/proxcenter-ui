/**
 * Tell a plain lease expiry apart from a lease that ended because the
 * license was moved to another instance (D5).
 *
 * `licenseStatus.lease_error` fires for both: a check-in that could not
 * renew the lease, and a license this instance used to hold that another
 * instance has since claimed. The two need different copy (moved-to-another
 * instance advice has no "Check in now" step, since checking in again never
 * brings the license back here), and the only signal that tells them apart
 * is `connection.held`: the license still shows up there with `lost: true`
 * only when it moved, not when it simply failed to renew.
 *
 * Shared by the Settings > License connection block and the navbar's
 * critical notification so both read the same verdict.
 */

type HeldEntry = { license_id?: string | null; lost?: boolean }
type LicenseStatusLike = { lease_error?: string | null; license_id?: string | null } | null | undefined
type ConnectionLike = { held?: HeldEntry[] | null } | null | undefined

export function isMovedLicenseExpired(licenseStatus: LicenseStatusLike, connection: ConnectionLike): boolean {
  if (!licenseStatus?.lease_error) return false

  const licenseId = licenseStatus.license_id
  if (!licenseId) return false

  return !!connection?.held?.some(h => h.license_id === licenseId && h.lost === true)
}
