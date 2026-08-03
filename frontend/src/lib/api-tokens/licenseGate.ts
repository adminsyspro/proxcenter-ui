// License verdict for the token path (spec D6). getServerLicense() hits the
// orchestrator with cache: "no-store", so the TOKEN path caches the VERDICT
// for 60 seconds, only to avoid one orchestrator round trip per API call.
// Fail-closed by construction: effectiveHasFeature denies on null/unlicensed/
// expired, and getServerLicense falls back to community when the orchestrator
// is unreachable. No grace period (product owner decision).
// Calls through the _impl indirection so vi.spyOn(mod._impl, 'getServerLicense')
// keeps working (frontend/src/lib/auth/requireEnterprise.ts:73).
import { _impl } from "@/lib/auth/requireEnterprise"
import { effectiveHasFeature, Features } from "@/lib/license/features"

const VERDICT_TTL_MS = 60_000

let cachedVerdict: { value: boolean; at: number } | null = null

export async function isApiAccessLicensed(): Promise<boolean> {
  const now = Date.now()
  if (cachedVerdict && now - cachedVerdict.at < VERDICT_TTL_MS) return cachedVerdict.value
  const license = await _impl.getServerLicense()
  const value = effectiveHasFeature(license, Features.API_ACCESS)
  cachedVerdict = { value, at: now }
  return value
}

/** @internal test hook */
export function _resetLicenseVerdictCache(): void {
  cachedVerdict = null
}
