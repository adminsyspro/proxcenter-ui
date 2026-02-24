'use client'

import { createContext, useContext, useEffect, useState, useCallback, useMemo, ReactNode } from 'react'

// Features disponibles
export const Features = {
  DRS: 'drs',
  FIREWALL: 'firewall',
  MICROSEGMENTATION: 'microsegmentation',
  ROLLING_UPDATES: 'rolling_updates',
  AI_INSIGHTS: 'ai_insights',
  PREDICTIVE_ALERTS: 'predictive_alerts',
  ALERTS: 'alerts',
  GREEN_METRICS: 'green_metrics',
  CROSS_CLUSTER_MIGRATION: 'cross_cluster_migration',
  CEPH_REPLICATION: 'ceph_replication',
  LDAP: 'ldap',
  REPORTS: 'reports',
  RBAC: 'rbac',
  TASK_CENTER: 'task_center',
  NOTIFICATIONS: 'notifications',
  CVE_SCANNER: 'cve_scanner',
  COMPLIANCE: 'compliance',
} as const

type FeatureId = typeof Features[keyof typeof Features]

// Edition → features mapping (single source of truth, mirrors backend EditionFeatures)
const EDITION_FEATURES: Record<string, readonly FeatureId[]> = {
  enterprise: [
    Features.DRS,
    Features.FIREWALL,
    Features.MICROSEGMENTATION,
    Features.ROLLING_UPDATES,
    Features.AI_INSIGHTS,
    Features.PREDICTIVE_ALERTS,
    Features.ALERTS,
    Features.GREEN_METRICS,
    Features.CROSS_CLUSTER_MIGRATION,
    Features.CEPH_REPLICATION,
    Features.LDAP,
    Features.REPORTS,
    Features.RBAC,
    Features.TASK_CENTER,
    Features.NOTIFICATIONS,
    Features.CVE_SCANNER,
  ],
  enterprise_plus: [
    Features.DRS,
    Features.FIREWALL,
    Features.MICROSEGMENTATION,
    Features.ROLLING_UPDATES,
    Features.AI_INSIGHTS,
    Features.PREDICTIVE_ALERTS,
    Features.ALERTS,
    Features.GREEN_METRICS,
    Features.CROSS_CLUSTER_MIGRATION,
    Features.CEPH_REPLICATION,
    Features.LDAP,
    Features.REPORTS,
    Features.RBAC,
    Features.TASK_CENTER,
    Features.NOTIFICATIONS,
    Features.CVE_SCANNER,
    Features.COMPLIANCE,
  ],
}

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
      }
    } catch (e: any) {
      console.error('Failed to load license status:', e)
      setError(e?.message || 'Failed to load license status')
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

  const hasFeature = useCallback((featureId: FeatureId | string): boolean => {
    if (!isLicensed) return false
    const edition = status?.edition || ''
    const editionFeatures = EDITION_FEATURES[edition]
    if (!editionFeatures) return false
    return editionFeatures.includes(featureId as FeatureId)
  }, [isLicensed, status?.edition])

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
