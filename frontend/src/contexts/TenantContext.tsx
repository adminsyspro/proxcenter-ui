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
  const [availableTenants, setAvailableTenants] = useState<TenantInfo[]>([])
  const [currentTenant, setCurrentTenant] = useState<TenantInfo | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!session?.user?.id) {
      setLoading(false)
      return
    }

    fetch('/api/v1/auth/me/tenants')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(data => {
        const tenants = data.data || []
        setAvailableTenants(tenants)
        const currentId = (session.user as any).tenantId || data.currentTenantId || 'default'
        const current = tenants.find((t: TenantInfo) => t.id === currentId) || tenants[0] || null
        setCurrentTenant(current)
      })
      .catch((err) => {
        console.error('[TenantContext] Failed to fetch tenants:', err)
      })
      .finally(() => setLoading(false))
  }, [session?.user?.id])

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

  const isProvider = (currentTenant?.id ?? DEFAULT_TENANT_ID) === DEFAULT_TENANT_ID
  const isMsp = currentTenant?.operatingModel === 'msp'

  return (
    <TenantContext.Provider value={{
      currentTenant,
      availableTenants,
      switchTenant,
      loading,
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
