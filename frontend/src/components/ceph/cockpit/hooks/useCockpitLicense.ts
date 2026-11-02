'use client'

import { useLicense } from '@/contexts/LicenseContext'

/**
 * Fail-closed : `enterprise` reste faux tant que la licence n'est pas arrivee.
 * `resolved` dit si la reponse est arrivee (pour ne pas ramener une URL Enterprise a `live` pendant le chargement).
 */
export function useCockpitLicense(): { enterprise: boolean; resolved: boolean } {
  const { isEnterprise, loading } = useLicense()

  return { enterprise: !loading && isEnterprise === true, resolved: !loading }
}
