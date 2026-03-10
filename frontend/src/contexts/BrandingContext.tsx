'use client'

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'

export interface BrandingConfig {
  enabled: boolean
  appName: string
  logoUrl: string
  faviconUrl: string
  loginLogoUrl: string
  primaryColor: string
  footerText: string
  browserTitle: string
  poweredByVisible: boolean
}

const DEFAULT_BRANDING: BrandingConfig = {
  enabled: false,
  appName: 'ProxCenter',
  logoUrl: '',
  faviconUrl: '',
  loginLogoUrl: '',
  primaryColor: '',
  footerText: '',
  browserTitle: '',
  poweredByVisible: true,
}

interface BrandingContextValue {
  branding: BrandingConfig
  loading: boolean
  refresh: () => Promise<void>
}

const BrandingContext = createContext<BrandingContextValue>({
  branding: DEFAULT_BRANDING,
  loading: true,
  refresh: async () => {},
})

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<BrandingConfig>(DEFAULT_BRANDING)
  const [loading, setLoading] = useState(true)

  const fetchBranding = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/settings/branding/public?_t=${Date.now()}`)
      if (res.ok) {
        const data = await res.json()
        console.log('[branding] fetched:', data)
        setBranding(prev => ({ ...prev, ...data }))
      } else {
        console.warn('[branding] fetch failed:', res.status)
      }
    } catch (err) {
      console.warn('[branding] fetch error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchBranding()
  }, [fetchBranding])

  // Update favicon dynamically
  useEffect(() => {
    if (branding.faviconUrl) {
      const link = document.querySelector("link[rel~='icon']") as HTMLLinkElement
      if (link) {
        link.href = branding.faviconUrl
      } else {
        const newLink = document.createElement('link')
        newLink.rel = 'icon'
        newLink.href = branding.faviconUrl
        document.head.appendChild(newLink)
      }
    }
  }, [branding.faviconUrl])

  // Update browser title dynamically
  useEffect(() => {
    if (branding.browserTitle) {
      document.title = branding.browserTitle
    }
  }, [branding.browserTitle])


  return (
    <BrandingContext.Provider value={{ branding, loading, refresh: fetchBranding }}>
      {children}
    </BrandingContext.Provider>
  )
}

export function useBranding() {
  return useContext(BrandingContext)
}

export { DEFAULT_BRANDING }
