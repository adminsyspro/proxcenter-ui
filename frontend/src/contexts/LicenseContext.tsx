'use client'

import { createContext, useContext, useEffect, useState, useCallback, useMemo, ReactNode } from 'react'
import { Features, EDITION_FEATURES, effectiveHasFeature, type FeatureId } from '@/lib/license/features'

export { Features }
export type { FeatureId }

interface LicenseStatus {
  licensed: boolean
  expired: boolean
  edition?: string
  features?: string[]
  options?: string[]
  is_nfr?: boolean
  [key: string]: any
}

interface Feature {
  id: string
  enabled: boolean
  [key: string]: any
}

interface LicenseContextValue {
  status: LicenseStatus | null
  loading: boolean
  error: string | null
  isLicensed: boolean
  isEnterprise: boolean
  isNFR: boolean
  features: Feature[]
  hasFeature: (featureId: FeatureId | string) => boolean
  refresh: () => Promise<void>
}

const LicenseContext = createContext<LicenseContextValue>({
  status: null,
  loading: true,
  error: null,
  isLicensed: false,
  isEnterprise: false,
  isNFR: false,
  features: [],
  hasFeature: () => false,
  refresh: async () => {},
})

const COMMUNITY_FALLBACK: LicenseStatus = {
  licensed: false,
  expired: false,
  edition: 'community',
  features: [],
  options: [],
}

export function LicenseProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<LicenseStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadLicenseStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/license/status')
      if (res.ok) {
        const data = await res.json()
        setStatus(data)
        setError(null)
      } else {
        setError('Failed to load license status')
        setStatus({ ...COMMUNITY_FALLBACK })
      }
    } catch (e: any) {
      console.error('Failed to load license status:', e)
      setError(e?.message || 'Failed to load license status')
      setStatus({ ...COMMUNITY_FALLBACK })
    }
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    await loadLicenseStatus()
    setLoading(false)
  }, [loadLicenseStatus])

  useEffect(() => {
    refresh()
  }, [refresh])

  const isLicensed = Boolean(status?.licensed && !status?.expired)
  const isEnterprise = status?.edition === 'enterprise' || status?.edition === 'enterprise_plus'

  // Derive features from edition
  const features: Feature[] = useMemo(() => {
    const edition = status?.edition || ''
    const editionFeatures = EDITION_FEATURES[edition] || []
    return editionFeatures.map(id => ({ id, enabled: isLicensed }))
  }, [status?.edition, isLicensed])

  const hasFeature = useCallback(
    (featureId: FeatureId | string): boolean => effectiveHasFeature(status, featureId),
    [status],
  )

  return (
    <LicenseContext.Provider value={{
      status,
      loading,
      error,
      isLicensed,
      isEnterprise,
      isNFR: Boolean(status?.is_nfr),
      features,
      hasFeature,
      refresh,
    }}>
      {children}
    </LicenseContext.Provider>
  )
}

export function useLicense() {
  const context = useContext(LicenseContext)
  if (!context) {
    throw new Error('useLicense must be used within a LicenseProvider')
  }
  return context
}

export default LicenseContext
