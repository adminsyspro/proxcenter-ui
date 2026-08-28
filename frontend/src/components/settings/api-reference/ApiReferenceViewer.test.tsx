import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'

const { configurations, brandingMock } = vi.hoisted(() => ({
  configurations: [] as any[],
  brandingMock: { logoUrl: '', appName: 'ProxCenter' },
}))

// The component imports Scalar's stylesheet; under vitest that import would
// drag the project's PostCSS config into the run for nothing.
vi.mock('@scalar/api-reference-react/style.css', () => ({}))

// Scalar mounts a Vue app into a DOM node: nothing to assert on under jsdom
// except the configuration we hand it, which is the whole contract here.
vi.mock('@scalar/api-reference-react', () => ({
  ApiReferenceReact: ({ configuration }: { configuration: any }) => {
    configurations.push(configuration)
    return <div data-testid='scalar' />
  },
}))

vi.mock('@/contexts/BrandingContext', () => ({
  useBranding: () => ({ branding: brandingMock, loading: false }),
}))

import { renderWithProviders } from '@/__tests__/setup/renderWithProviders'
import ApiReferenceViewer, { PUBLIC_API_SPEC_URL, withLogo } from './ApiReferenceViewer'

const DOCUMENT = {
  openapi: '3.1.0',
  info: { title: 'ProxCenter public read-only API', version: '1', description: 'Read-only API for monitoring.' },
  paths: {},
}

// jsdom never lays anything out, so the setup file's ResizeObserver stub is
// inert. This one reports a 600px box as soon as it is asked to observe.
class MeasuringResizeObserver {
  constructor(private readonly cb: ResizeObserverCallback) {}
  observe() {
    this.cb([{ contentRect: { height: 600 } } as ResizeObserverEntry], this as unknown as ResizeObserver)
  }
  unobserve() {}
  disconnect() {}
}

class InertResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function stubSpecFetch(status = 200) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === PUBLIC_API_SPEC_URL) return new Response(JSON.stringify(DOCUMENT), { status })
    return new Response('{}', { status: 404 })
  }))
}

beforeEach(() => {
  configurations.length = 0
  brandingMock.logoUrl = ''
  brandingMock.appName = 'ProxCenter'
  vi.stubGlobal('ResizeObserver', MeasuringResizeObserver)
  stubSpecFetch()
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

describe('ApiReferenceViewer', () => {
  it('mounts Scalar once the host box has a measured height and the document is fetched, and hands the height over', async () => {
    renderWithProviders(<ApiReferenceViewer />)
    expect(await screen.findByTestId('scalar')).toBeInTheDocument()
    expect(screen.getByTestId('api-reference-host').style.getPropertyValue('--pxc-api-reference-height')).toBe('600px')
  })

  it('renders the fetched document with the brand mark on top of its description, in the current colour mode', async () => {
    renderWithProviders(<ApiReferenceViewer />)
    await screen.findByTestId('scalar')
    const config = configurations.at(-1)
    expect(config.url).toBeUndefined()
    expect(config.content.info.description).toBe(
      '<img src="/images/proxcenter-logo-light.svg" alt="ProxCenter" width="110">\n\nRead-only API for monitoring.',
    )
    expect(config.content.paths).toEqual({})
    expect(fetch).toHaveBeenCalledWith(PUBLIC_API_SPEC_URL, expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })

  it('prefers the white-label logo and name when branding sets them', async () => {
    brandingMock.logoUrl = '/api/v1/branding/assets/logo.png'
    brandingMock.appName = 'Acme Cloud'
    renderWithProviders(<ApiReferenceViewer />)
    await screen.findByTestId('scalar')
    expect(configurations.at(-1).content.info.description).toMatch(
      /^<img src="\/api\/v1\/branding\/assets\/logo\.png" alt="Acme Cloud" width="110">/,
    )
  })

  it('targets this origin, with no proxy, telemetry, persisted auth, agent, MCP, toolbar or remote fonts', async () => {
    renderWithProviders(<ApiReferenceViewer />)
    await screen.findByTestId('scalar')
    const config = configurations.at(-1)
    expect(config.servers).toEqual([{ url: window.location.origin, description: 'This ProxCenter instance' }])
    expect(config.authentication).toEqual({ preferredSecurityScheme: 'bearerAuth' })
    expect(config.persistAuth).toBe(false)
    expect(config.proxyUrl).toBe('')
    expect(config.telemetry).toBe(false)
    expect(config.agent).toEqual({ disabled: true })
    expect(config.mcp).toEqual({ disabled: true })
    expect(config.showDeveloperTools).toBe('never')
    expect(config.withDefaultFonts).toBe(false)
    expect(config.hideClientButton).toBe(true)
    expect(config.hideDarkModeToggle).toBe(true)
    expect(config.forceDarkModeState).toBe('light')
  })

  it('falls back to handing Scalar the URL when the document cannot be fetched', async () => {
    stubSpecFetch(500)
    renderWithProviders(<ApiReferenceViewer />)
    await screen.findByTestId('scalar')
    await waitFor(() => expect(configurations.at(-1).url).toBe(PUBLIC_API_SPEC_URL))
    expect(configurations.at(-1).content).toBeUndefined()
  })

  it('stays out of the DOM while the host has no height yet', () => {
    vi.stubGlobal('ResizeObserver', InertResizeObserver)
    renderWithProviders(<ApiReferenceViewer />)
    expect(screen.queryByTestId('scalar')).not.toBeInTheDocument()
  })
})

describe('withLogo', () => {
  it('escapes attribute values and copes with a document without description', () => {
    const patched = withLogo({ openapi: '3.1.0', info: { title: 'T' } }, '/logo"x.svg', 'A & <B>')
    expect(patched.info?.description).toBe('<img src="/logo&quot;x.svg" alt="A &amp; &lt;B&gt;" width="110">')
    expect(patched.info?.title).toBe('T')
  })
})
