/**
 * Feature detection for the multi-license stacking feature (Pillar C).
 *
 * The orchestrator only registers the `/api/v1/license/import(s)` routes when
 * its `FEATURE_MULTI_LICENSE` flag is on. So a successful (200) response from
 * `GET /api/v1/license/imports` means the feature is enabled; a 404 (route not
 * registered) or 503 (orchestrator down) means it is off. This keeps the flag
 * single-sourced on the orchestrator with no separate frontend env var.
 */
export function isMultiLicenseEnabled(importsHttpStatus: number): boolean {
  return importsHttpStatus === 200
}
