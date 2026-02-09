import { useState, useEffect, useCallback } from 'react'

export function useLicenseManagement() {
  const [licenseStatus, setLicenseStatus] = useState<any>(null)
  const [features, setFeatures] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [activating, setActivating] = useState(false)

  const loadLicenseStatus = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/v1/license/status')

      if (res.ok) {
        const data = await res.json()
        setLicenseStatus(data)
      }
    } catch (e) {
      console.error('Failed to load license status', e)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadFeatures = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/license/features')

      if (res.ok) {
        const data = await res.json()
        setFeatures(data.features || [])
      }
    } catch (e) {
      console.error('Failed to load features', e)
    }
  }, [])

  useEffect(() => {
    loadLicenseStatus()
    loadFeatures()
  }, [loadLicenseStatus, loadFeatures])

  const handleActivate = useCallback(async (licenseKey: string) => {
    setActivating(true)
    setError(null)
    setSuccess(null)

    try {
      const res = await fetch('/api/v1/license/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ license: licenseKey }),
      })

      const data = await res.json()

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Activation failed')
      }

      await loadLicenseStatus()
      await loadFeatures()

      return { success: true } as const
    } catch (e: any) {
      return { success: false, error: e?.message || 'Activation failed' } as const
    } finally {
      setActivating(false)
    }
  }, [loadLicenseStatus, loadFeatures])

  const handleDeactivate = useCallback(async () => {
    setActivating(true)
    setError(null)
    setSuccess(null)

    try {
      const res = await fetch('/api/v1/license/deactivate', { method: 'DELETE' })
      const data = await res.json()

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Deactivation failed')
      }

      await loadLicenseStatus()
      await loadFeatures()

      return { success: true } as const
    } catch (e: any) {
      return { success: false, error: e?.message || 'Deactivation failed' } as const
    } finally {
      setActivating(false)
    }
  }, [loadLicenseStatus, loadFeatures])

  return {
    licenseStatus,
    features,
    loading,
    error,
    success,
    activating,
    setError,
    setSuccess,
    loadLicenseStatus,
    loadFeatures,
    handleActivate,
    handleDeactivate,
  }
}
