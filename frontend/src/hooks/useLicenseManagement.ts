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
    void loadLicenseStatus()
    void loadFeatures()
  }, [loadLicenseStatus, loadFeatures])

  const handleActivate = useCallback(async (licenseKey: string) => {
    setActivating(true)
    setError(null)
    setSuccess(null)

    try {
      // Clean up whitespace artifacts from PDF copy-paste
      const cleanedKey = licenseKey
        .split('\n')
        .map((line) => line.trimEnd())
        .join('\n')
        .trim()

      const res = await fetch('/api/v1/license/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ license: cleanedKey }),
      })

      const data = await res.json()

      if (!res.ok || !data.success) {
        if (data?.code === 'LICENSE_BINDING_MISMATCH') {
          return { success: false, error: data.error, code: data.code, expected: data.expected_fingerprint, actual: data.actual_fingerprint } as const
        }
        throw new Error(data.error || 'Activation failed')
      }

      await loadLicenseStatus()
      await loadFeatures()

      window.location.reload()
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

  // Downloads the signed license request file (Settings > License > Generate).
  const downloadLicenseRequest = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/license/request', { cache: 'no-store' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        return { success: false, error: data?.error || `HTTP ${res.status}`, code: data?.code } as const
      }
      const blob = await res.blob()
      const match = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = match?.[1] || 'proxcenter-license-request.json'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      return { success: true } as const
    } catch (e: any) {
      return { success: false, error: e?.message || 'Request failed' } as const
    }
  }, [])

  // Regenerates the install identity; a license bound to the previous
  // fingerprint then shows a binding error until rebound.
  const resetInstallIdentity = useCallback(async () => {
    setActivating(true)
    try {
      const res = await fetch('/api/v1/license/identity/reset', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.success) {
        return { success: false, error: data?.error || `HTTP ${res.status}` } as const
      }
      await loadLicenseStatus()
      return { success: true } as const
    } catch (e: any) {
      return { success: false, error: e?.message || 'Reset failed' } as const
    } finally {
      setActivating(false)
    }
  }, [loadLicenseStatus])

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
    downloadLicenseRequest,
    resetInstallIdentity,
  }
}
