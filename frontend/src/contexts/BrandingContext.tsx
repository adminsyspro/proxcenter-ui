'use client'

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'

import { useSession } from 'next-auth/react'

export interface BrandingHighlight {
  icon: string
  text: string
}

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
  showGithubStars: boolean
  showWhatsNew: boolean
  showAbout: boolean
  showSubscription: boolean
  loginTagline: string
  loginHighlights: BrandingHighlight[]
  docsUrl: string
  supportUrl: string
  changelogUrl: string
  hideVersion: boolean
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
  showGithubStars: true,
  showWhatsNew: true,
  showAbout: true,
  showSubscription: true,
  loginTagline: '',
  loginHighlights: [],
  docsUrl: '',
  supportUrl: '',
  changelogUrl: '',
  hideVersion: false,
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

  // The branding API resolves the tenant from the session JWT
  // (getCurrentTenantId on the server). Tracking session here lets us
  // refetch when login/logout or tenant-switch changes the answer — without
  // this, the provider mounts once at app boot (in the root layout) with
  // an empty session, caches the default-tenant branding, and the only way
  // to pick up the tenant's white-label is a hard reload.
  const { data: session, status } = useSession()
  const sessionUserId = (session as any)?.user?.id || null
  const sessionTenantId = (session as any)?.user?.tenantId || null

  const fetchBranding = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/settings/branding/public?_t=${Date.now()}`)

      if (res.ok) {
        const data = await res.json()

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

  // Initial fetch + refetch on session identity change. `status` flips to
  // 'authenticated' / 'unauthenticated' once NextAuth has resolved, and
  // sessionUserId / sessionTenantId change on login, logout, or tenant
  // switch — all three cases want a fresh branding payload.
  useEffect(() => {
    if (status === 'loading') return
    fetchBranding()
  }, [fetchBranding, status, sessionUserId, sessionTenantId])

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
