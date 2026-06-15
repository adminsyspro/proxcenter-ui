/**
 * Detection for whether the multi-license management UI should be shown.
 *
 * The orchestrator always registers the `/api/v1/license/import(s)` routes
 * (multi-license is the product behaviour, not a flag). A 200 from
 * `GET /api/v1/license/imports` therefore means the orchestrator is reachable
 * and new enough to expose the multi-license API; a 404 (an older orchestrator
 * without the routes) or 503 (orchestrator down) falls back to the basic
 * single-license view.
 */
export function isMultiLicenseEnabled(importsHttpStatus: number): boolean {
  return importsHttpStatus === 200
}
