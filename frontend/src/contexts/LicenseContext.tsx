'use client'

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react'

// Features disponibles
export const Features = {
  DRS: 'drs',
  FIREWALL: 'firewall',
  MICROSEGMENTATION: 'microsegmentation',
  ROLLING_UPDATES: 'rolling_updates',
  AI_INSIGHTS: 'ai_insights',
  PREDICTIVE_ALERTS: 'predictive_alerts',
  GREEN_METRICS: 'green_metrics',
  CROSS_CLUSTER_MIGRATION: 'cross_cluster_migration',
  CEPH_REPLICATION: 'ceph_replication',
  LDAP: 'ldap',
  REPORTS: 'reports',
} as const

type FeatureId = typeof Features[keyof typeof Features]

interface LicenseStatus {
  licensed: boolean
  expired: boolean
  edition?: string
  features?: string[]
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
  features: [],
  hasFeature: () => false,
  refresh: async () => {},
})

export function LicenseProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<LicenseStatus | null>(null)
  const [features, setFeatures] = useState<Feature[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadLicenseStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/license/status', { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        setStatus(data)
        setError(null)
      } else {
        setError('Failed to load license status')
      }
    } catch (e: any) {
      console.error('Failed to load license status:', e)
      setError(e?.message || 'Failed to load license status')
    }
  }, [])

  const loadFeatures = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/license/features', { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        setFeatures(data.features || [])
      }
    } catch (e) {
      console.error('Failed to load features:', e)
    }
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    await Promise.all([loadLicenseStatus(), loadFeatures()])
    setLoading(false)
  }, [loadLicenseStatus, loadFeatures])

  useEffect(() => {
    refresh()
  }, [refresh])

  const isLicensed = Boolean(status?.licensed && !status?.expired)
  const isEnterprise = status?.edition === 'enterprise'

  const hasFeature = useCallback((featureId: FeatureId | string): boolean => {
    if (!isLicensed) return false

    // Si pas de features dans le statut, vérifier dans la liste des features
    if (status?.features && Array.isArray(status.features)) {
      return status.features.includes(featureId)
    }

    // Fallback: vérifier dans la liste des features chargées
    const feature = features.find(f => f.id === featureId)
    return feature?.enabled === true
  }, [isLicensed, status, features])

  return (
    <LicenseContext.Provider value={{
      status,
      loading,
      error,
      isLicensed,
      isEnterprise,
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
