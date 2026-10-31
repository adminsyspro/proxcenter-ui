'use client'

import { useLicense } from '@/contexts/LicenseContext'
import { useTenant } from '@/contexts/TenantContext'
import { Features } from '@/lib/license/features'
import { DEFAULT_TENANT_ID } from '@/lib/tenant/constants'

/** True when the incident register is on offer: Default tenant, loaded, with the `incidents` feature. */
export function useIncidentsEnabled(): boolean {
  const { currentTenant, loading } = useTenant()
  const { hasFeature } = useLicense()

  return !loading && currentTenant?.id === DEFAULT_TENANT_ID && hasFeature(Features.INCIDENTS)
}
