import { useCallback, useState } from 'react'

import { fetcher, useSWRFetch } from './useSWRFetch'

/**
 * A hardening read collects the whole cluster (3 API calls per guest plus an
 * SSH audit per node), so it is never repeated on its own: no refresh when the
 * browser tab regains focus or the network comes back. The server reuses a
 * recent collection anyway; `rescan` (the scan button) asks it for a fresh one.
 */
export const COMPLIANCE_SWR_OPTIONS = { revalidateOnFocus: false, revalidateOnReconnect: false } as const

export function hardeningChecksUrl(connectionId?: string | null, profileId?: string | null, node?: string | null): string | null {
  if (!connectionId) return null
  const params = new URLSearchParams()
  if (profileId) params.set('profileId', profileId)
  if (node) params.set('node', node)
  const qs = params.toString()

  return `/api/v1/compliance/hardening/${connectionId}${qs ? `?${qs}` : ''}`
}

/** The same read, asking the server for a collection made now rather than a reused one. */
export function freshScanUrl(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}refresh=1`
}

export function useHardeningChecks(
  connectionId?: string | null,
  profileId?: string | null,
  node?: string | null
) {
  const url = hardeningChecksUrl(connectionId, profileId, node)
  const swr = useSWRFetch(url, COMPLIANCE_SWR_OPTIONS)
  const { mutate } = swr
  // mutate(promise) does not flag SWR as loading: the scan button follows this instead.
  const [isScanning, setIsScanning] = useState(false)

  const rescan = useCallback(async () => {
    if (!url) return
    setIsScanning(true)
    try {
      await mutate(fetcher(freshScanUrl(url)), { revalidate: false })
    } catch {
      // SWR keeps the previous result and exposes the error; nothing more to do here.
    } finally {
      setIsScanning(false)
    }
  }, [url, mutate])

  return { ...swr, rescan, isScanning }
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
