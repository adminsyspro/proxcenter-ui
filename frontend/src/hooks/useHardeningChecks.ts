import { useSWRFetch } from './useSWRFetch'

export function useHardeningChecks(
  connectionId?: string | null,
  profileId?: string | null
) {
  let url: string | null = null
  if (connectionId) {
    const params = new URLSearchParams()
    if (profileId) params.set('profileId', profileId)
    const qs = params.toString()
    url = `/api/v1/compliance/hardening/${connectionId}${qs ? `?${qs}` : ''}`
  }
  return useSWRFetch(url)
}

export function useSecurityPolicies() {
  return useSWRFetch('/api/v1/compliance/policies')
}

export function useComplianceProfiles(connectionId?: string | null) {
  const url = connectionId
    ? `/api/v1/compliance/profiles?connectionId=${connectionId}`
    : '/api/v1/compliance/profiles'
  return useSWRFetch(url)
}

export function useComplianceProfile(profileId?: string | null) {
  return useSWRFetch(
    profileId ? `/api/v1/compliance/profiles/${profileId}` : null
  )
}
