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

// The uploaded favicon keeps the extension it was stored under (see the
// branding uploads route), and the stock <link> tags carry a type of their
// own, so the type has to be recomputed rather than inherited.
const FAVICON_MIME_TYPES: Record<string, string> = {
  ico: 'image/x-icon',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
}

function faviconMimeType(url: string): string {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase() ?? ''

  return FAVICON_MIME_TYPES[ext] ?? ''
}

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

  // Update favicon dynamically.
  //
  // src/app ships BOTH favicon.ico and icon.svg, so Next renders two icon
  // links, in that order:
  //   <link rel="icon" href="/favicon.ico?…" sizes="48x48" type="image/x-icon">
  //   <link rel="icon" href="/icon.svg?…"    sizes="any"   type="image/svg+xml">
  // Browsers keep the SVG (declared last, and preferred because it scales),
  // so repointing the first match alone left the stock icon in the tab and
  // the white-label one loaded by nobody. Every icon link has to follow, and
  // the stock type/sizes have to go with them, or a PNG upload is announced
  // as a 48x48 image/x-icon. The tags are mutated rather than replaced: they
  // are rendered by Next's metadata, and removing them from under React is
  // what turns a cosmetic bug into a crash on navigation.
  useEffect(() => {
    const url = branding.faviconUrl

    if (!url) return

    const type = faviconMimeType(url)
    const existing = Array.from(document.querySelectorAll<HTMLLinkElement>("link[rel~='icon']"))

    let created: HTMLLinkElement | null = null

    if (existing.length === 0) {
      created = document.createElement('link')
      created.rel = 'icon'
      document.head.appendChild(created)
      existing.push(created)
    }

    const stock = existing.map(link => ({
      link,
      href: link.getAttribute('href'),
      type: link.getAttribute('type'),
      sizes: link.getAttribute('sizes'),
    }))

    for (const { link } of stock) {
      link.setAttribute('href', url)
      link.removeAttribute('sizes')

      if (type) link.setAttribute('type', type)
      else link.removeAttribute('type')
    }

    // Put the stock icons back when the tenant clears the upload, or when a
    // tenant switch lands on a tenant without one — otherwise the previous
    // tenant's icon stays in the tab until the next hard reload.
    return () => {
      if (created) {
        created.remove()

        return
      }

      for (const entry of stock) {
        for (const [name, value] of [['href', entry.href], ['type', entry.type], ['sizes', entry.sizes]] as const) {
          if (value === null) entry.link.removeAttribute(name)
          else entry.link.setAttribute(name, value)
        }
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
