import { useSWRFetch } from './useSWRFetch'

export function useHardeningChecks(connectionId?: string | null) {
  return useSWRFetch(
    connectionId ? `/api/v1/compliance/hardening/${connectionId}` : null
  )
}

export function useSecurityPolicies() {
  return useSWRFetch('/api/v1/compliance/policies')
}
