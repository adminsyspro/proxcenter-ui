import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({
  session: { data: null as unknown, status: 'unauthenticated' as string },
  payload: {} as Record<string, unknown>,
}))

vi.mock('next-auth/react', () => ({ useSession: () => h.session }))

import { BrandingProvider, useBranding } from './BrandingContext'

const Probe = () => {
  const { branding, loading } = useBranding()

  return <output data-testid='probe'>{loading ? 'loading' : branding.appName}</output>
}

const renderProvider = () =>
  render(
    <BrandingProvider>
      <Probe />
    </BrandingProvider>
  )

// What Next renders for this tree: src/app ships both favicon.ico and
// icon.svg, so there are two icon links and the browser keeps the SVG one.
const appendIcon = (attributes: Record<string, string>) => {
  const link = document.createElement('link')

  link.rel = 'icon'
  for (const [name, value] of Object.entries(attributes)) link.setAttribute(name, value)
  document.head.appendChild(link)
}

const iconHrefs = () =>
  Array.from(document.querySelectorAll<HTMLLinkElement>("link[rel~='icon']")).map(link => link.getAttribute('href'))

beforeEach(() => {
  h.session = { data: null, status: 'unauthenticated' }
  h.payload = { enabled: false, appName: 'ProxCenter', faviconUrl: '', browserTitle: '' }
  document.head.replaceChildren()
  document.title = 'PROXCENTER'
  appendIcon({ href: '/favicon.ico?hash.ico', sizes: '48x48', type: 'image/x-icon' })
  appendIcon({ href: '/icon.svg?hash.svg', sizes: 'any', type: 'image/svg+xml' })
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => h.payload }) as unknown as Response)
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('BrandingProvider', () => {
  it('publishes the fetched branding', async () => {
    h.payload = { enabled: true, appName: 'MSP Cloud', faviconUrl: '', browserTitle: '' }

    const { getByTestId } = renderProvider()

    await waitFor(() => expect(getByTestId('probe')).toHaveTextContent('MSP Cloud'))
  })

  it('waits for NextAuth to resolve before asking for branding', () => {
    h.session = { data: null, status: 'loading' }

    renderProvider()

    expect(fetch).not.toHaveBeenCalled()
  })

  // The reported bug: only the first icon link used to follow, which is the
  // .ico, while the browser reads the .svg.
  it('points every icon link at the white-label favicon', async () => {
    h.payload = {
      enabled: true,
      appName: 'MSP Cloud',
      faviconUrl: '/api/v1/settings/branding/uploads/favicon.png?t=1',
      browserTitle: '',
    }

    renderProvider()

    await waitFor(() =>
      expect(iconHrefs()).toEqual([
        '/api/v1/settings/branding/uploads/favicon.png?t=1',
        '/api/v1/settings/branding/uploads/favicon.png?t=1',
      ])
    )
  })

  it('leaves the stock icons alone when no favicon was uploaded', async () => {
    h.payload = { enabled: true, appName: 'MSP Cloud', faviconUrl: '', browserTitle: '' }

    const { getByTestId } = renderProvider()

    await waitFor(() => expect(getByTestId('probe')).toHaveTextContent('MSP Cloud'))
    expect(iconHrefs()).toEqual(['/favicon.ico?hash.ico', '/icon.svg?hash.svg'])
  })

  it('applies the white-label browser title', async () => {
    h.payload = { enabled: true, appName: 'MSP Cloud', faviconUrl: '', browserTitle: 'MSP Cloud Console' }

    renderProvider()

    await waitFor(() => expect(document.title).toBe('MSP Cloud Console'))
  })

  it('keeps the defaults when the branding call fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 }) as unknown as Response))

    const { getByTestId } = renderProvider()

    await waitFor(() => expect(getByTestId('probe')).toHaveTextContent('ProxCenter'))
    expect(iconHrefs()).toEqual(['/favicon.ico?hash.ico', '/icon.svg?hash.svg'])
  })

  it('keeps the defaults when the branding call throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))

    const { getByTestId } = renderProvider()

    await waitFor(() => expect(getByTestId('probe')).toHaveTextContent('ProxCenter'))
  })
})
