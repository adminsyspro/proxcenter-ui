'use client'

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'

import { DEFAULT_TENANT_ID } from '@/lib/tenant/constants'

interface TenantInfo {
  id: string
  slug: string
  name: string
  description?: string | null
  operatingModel?: string | null
  vmidRangeStart?: number | null
  vmidRangeEnd?: number | null
}

interface TenantContextType {
  currentTenant: TenantInfo | null
  availableTenants: TenantInfo[]
  switchTenant: (tenantId: string) => Promise<void>
  loading: boolean
  isMultiTenant: boolean
  isProvider: boolean
  isMsp: boolean
  isFullClusterView: boolean
}

const TenantContext = createContext<TenantContextType>({
  currentTenant: null,
  availableTenants: [],
  switchTenant: async () => {},
  loading: true,
  isMultiTenant: false,
  isProvider: true,
  isMsp: false,
  isFullClusterView: true,
})

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession()
  const userId = session?.user?.id
  const tenantId = (session?.user as any)?.tenantId ?? null
  const identityKey = JSON.stringify([userId, tenantId])
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const [availableTenants, setAvailableTenants] = useState<TenantInfo[]>([])
  const [currentTenant, setCurrentTenant] = useState<TenantInfo | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let ignore = false
    if (!userId) {
      setAvailableTenants([])
      setCurrentTenant(null)
      setLoading(false)
      setLoadedKey(identityKey)
      return
    }

    setLoading(true)
    fetch('/api/v1/auth/me/tenants')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(data => {
        if (ignore) return
        const tenants = data.data || []
        setAvailableTenants(tenants)
        const currentId = tenantId || data.currentTenantId || DEFAULT_TENANT_ID
        const current = tenants.find((t: TenantInfo) => t.id === currentId) || null
        setCurrentTenant(current)
      })
      .catch((err) => {
        if (ignore) return
        setAvailableTenants([])
        setCurrentTenant(null)
        console.error('[TenantContext] Failed to fetch tenants:', err)
      })
      .finally(() => {
        if (!ignore) { setLoading(false); setLoadedKey(identityKey) }
      })
    return () => { ignore = true }
  }, [userId, tenantId, identityKey])

  const switchTenant = useCallback(async (tenantId: string) => {
    try {
      const res = await fetch('/api/v1/auth/switch-tenant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to switch tenant')
      }

      // Navigate to /home to refresh JWT, clear all cached data, and avoid stale onboarding state
      window.location.href = '/home'
    } catch (error) {
      console.error('[TenantContext] Failed to switch tenant:', error)
      throw error
    }
  }, [])

  const pending = loading || loadedKey !== identityKey
  const activeTenant = pending ? null : currentTenant
  const isProvider = activeTenant?.id === DEFAULT_TENANT_ID
  const isMsp = activeTenant?.operatingModel === 'msp'

  return (
    <TenantContext.Provider value={{
      currentTenant: activeTenant,
      availableTenants: pending ? [] : availableTenants,
      switchTenant,
      loading: pending,
      isMultiTenant: availableTenants.length > 1,
      isProvider,
      isMsp,
      isFullClusterView: isProvider || isMsp,
    }}>
      {children}
    </TenantContext.Provider>
  )
}

export function useTenant() {
  return useContext(TenantContext)
}
