'use client'

import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from 'react'

import { useSession } from 'next-auth/react'

import { applyFavicon } from '@/lib/branding/favicon'

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
  // The branding API resolves the tenant from the session JWT
  // (getCurrentTenantId on the server). Tracking session here lets us
  // refetch when login/logout or tenant-switch changes the answer — without
  // this, the provider mounts once at app boot (in the root layout) with
  // an empty session, caches the default-tenant branding, and the only way
  // to pick up the tenant's white-label is a hard reload.
  const { data: session, status } = useSession()
  const sessionUserId = (session as any)?.user?.id || null
  const sessionTenantId = (session as any)?.user?.tenantId || null

  const identity = JSON.stringify([status, sessionUserId, sessionTenantId])
  const [state, setState] = useState<{ identity: string; branding: BrandingConfig } | null>(null)
  const branding = state?.identity === identity ? state.branding : DEFAULT_BRANDING
  const loading = status === 'loading' || state?.identity !== identity
  const activeRequest = useRef<{ active: boolean } | null>(null)

  const fetchBranding = useCallback(async () => {
    if (activeRequest.current) activeRequest.current.active = false
    const request = { active: true }

    activeRequest.current = request
    let nextBranding: BrandingConfig | null = null

    try {
      const res = await fetch(`/api/v1/settings/branding/public?_t=${Date.now()}`)
      if (res.ok) {
        const data = await res.json()
        nextBranding = { ...DEFAULT_BRANDING, ...data }
      } else {
        console.warn('[branding] fetch failed:', res.status)
      }
    } catch (err) {
      console.warn('[branding] fetch error:', err)
    } finally {
      if (request.active) {
        setState(previous => ({
          identity,
          branding: nextBranding ?? (previous?.identity === identity ? previous.branding : DEFAULT_BRANDING),
        }))
      }
    }
  }, [identity])

  // Initial fetch + refetch on session identity change. `status` flips to
  // 'authenticated' / 'unauthenticated' once NextAuth has resolved, and
  // sessionUserId / sessionTenantId change on login, logout, or tenant
  // switch — all three cases want a fresh branding payload.
  useEffect(() => {
    if (status === 'loading') return
    void fetchBranding()
    const request = activeRequest.current

    return () => { if (request) request.active = false }
  }, [fetchBranding, status])

  // Update favicon dynamically. applyFavicon repoints EVERY icon link Next
  // rendered, not just the first one, and hands back the undo that restores
  // the stock icons when the upload is cleared. See lib/branding/favicon.
  useEffect(() => {
    if (!branding.faviconUrl) return

    return applyFavicon(branding.faviconUrl)
  }, [branding.faviconUrl])

  // Update browser title dynamically
  useEffect(() => {
    if (branding.browserTitle) {
      const previousTitle = document.title

      document.title = branding.browserTitle
      return () => { document.title = previousTitle }
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
