'use client'

import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react'

import { Box, useTheme } from '@mui/material'
import { ApiReferenceReact } from '@scalar/api-reference-react'
import { useTranslations } from 'next-intl'

import '@scalar/api-reference-react/style.css'

import { useBranding } from '@/contexts/BrandingContext'

// The generated document (`npm run generate:openapi`), served without
// authentication because `.json` is a static asset for the proxy. Rendering
// the same file customers fetch keeps the reference honest: there is no second
// copy of the contract to drift.
export const PUBLIC_API_SPEC_URL = '/openapi/proxcenter-public-api.json'

// Brand mark for each colour mode, used when no white-label logo is set.
const DEFAULT_LOGO = {
  light: '/images/proxcenter-logo-light.svg',
  dark: '/images/proxcenter-logo-dark.svg',
} as const

const LOGO_WIDTH = 110

const CODE_FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace'

type OpenApiDocument = Record<string, unknown> & { info?: Record<string, unknown> }

function escapeAttribute(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Puts the logo at the top of `info.description`, which Scalar renders as
 * Markdown right under the document title. Scalar 1.67 ignores the `x-logo`
 * extension, and its sanitizer keeps `src`, `alt` and `width` on a raw `<img>`,
 * so this is the one supported way to get a picture into the introduction.
 * The committed document stays untouched: only the in-memory copy is patched.
 */
export function withLogo(document: OpenApiDocument, logoUrl: string, alt: string): OpenApiDocument {
  const info = document.info ?? {}
  const description = typeof info.description === 'string' && info.description ? `\n\n${info.description}` : ''
  const img = `<img src="${escapeAttribute(logoUrl)}" alt="${escapeAttribute(alt)}" width="${LOGO_WIDTH}">`
  return { ...document, info: { ...info, description: `${img}${description}` } }
}

/**
 * Embeds the Scalar API reference for the public read-only API.
 *
 * The host must give this component a definite box (the page puts it in an
 * absolutely positioned inset). Scalar sizes its sticky sidebar and viewport
 * from `--full-height`, which it measures against the browser viewport; inside
 * an app shell that is the wrong reference, so we measure our own box and
 * override the variable with `!important` (Scalar sets it inline).
 */
export default function ApiReferenceViewer() {
  const theme = useTheme()
  const t = useTranslations('settings.apiTokens.reference')
  const { branding } = useBranding()
  const hostRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)
  const [document, setDocument] = useState<OpenApiDocument | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    const el = hostRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => {
      const next = Math.round(entries[0]?.contentRect.height ?? 0)
      setHeight(prev => (prev === next ? prev : next))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Fetched here rather than handed to Scalar as a URL so the logo can be
  // added before rendering. If the fetch fails, Scalar gets the URL instead
  // and shows its own error state for it.
  useEffect(() => {
    const controller = new AbortController()
    fetch(PUBLIC_API_SPEC_URL, { signal: controller.signal })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<OpenApiDocument>
      })
      .then(json => setDocument(json))
      .catch((err: unknown) => {
        if ((err as { name?: string })?.name !== 'AbortError') setLoadFailed(true)
      })
    return () => controller.abort()
  }, [])

  const serverDescription = t('thisInstance')
  const mode = theme.palette.mode
  const logoUrl = branding.logoUrl || DEFAULT_LOGO[mode]
  const logoAlt = branding.appName || 'ProxCenter'

  // Memoised: the React wrapper calls `updateConfiguration` whenever this
  // object identity changes, so a fresh literal on every render would reload
  // the reference on each parent re-render.
  const configuration = useMemo(
    () => ({
      ...(document ? { content: withLogo(document, logoUrl, logoAlt) } : { url: PUBLIC_API_SPEC_URL }),
      // Try-it targets the instance the operator is logged into, with the
      // token they just minted. That is the whole point of an in-product
      // reference over a static page hosted elsewhere, and it replaces the
      // `{proxcenterBaseUrl}` placeholder the document carries for offline use.
      servers: [{ url: typeof window === 'undefined' ? '/' : window.location.origin, description: serverDescription }],
      authentication: { preferredSecurityScheme: 'bearerAuth' },
      // A pasted pxc_ token is a credential: never park it in localStorage.
      persistAuth: false,
      // Direct requests from the browser to this origin; no third-party proxy.
      proxyUrl: '',
      telemetry: false,
      // "Agent Scalar" is an AI chat that uploads the document to Scalar's
      // servers, and it turns itself on for any localhost URL. Off, always.
      agent: { disabled: true },
      // Both also switch themselves on for localhost URLs: the "Generate MCP"
      // button (a Scalar-hosted service) and the developer toolbar.
      mcp: { disabled: true },
      showDeveloperTools: 'never' as const,
      hideClientButton: true,
      hideDarkModeToggle: true,
      forceDarkModeState: mode,
      // No font download from fonts.scalar.com: on-premise instances may have
      // no route to the internet, and the app font already matches MUI.
      withDefaultFonts: false,
      documentDownloadType: 'json' as const,
      showSidebar: true,
    }),
    [document, logoUrl, logoAlt, mode, serverDescription],
  )

  const ready = height > 0 && (document !== null || loadFailed)

  return (
    <Box
      ref={hostRef}
      data-testid='api-reference-host'
      style={{ '--pxc-api-reference-height': `${height}px` } as CSSProperties}
      sx={{
        position: 'absolute',
        inset: 0,
        overflow: 'auto',
        '--scalar-font': theme.typography.fontFamily,
        '--scalar-font-code': CODE_FONT,
        '& .scalar-api-reference': { '--full-height': 'var(--pxc-api-reference-height) !important' },
      }}
    >
      {ready && <ApiReferenceReact configuration={configuration} />}
    </Box>
  )
}
