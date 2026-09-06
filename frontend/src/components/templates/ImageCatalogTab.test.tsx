import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, waitFor, userEvent } from '@/__tests__/setup/renderWithProviders'

const tenantState = { id: 'default', loading: false }
const hasPermissionMock = vi.fn<(p: string) => boolean>(() => true)
const showToastMock = vi.fn()

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ currentTenant: { id: tenantState.id, name: tenantState.id, slug: tenantState.id }, loading: tenantState.loading }),
}))
vi.mock('@/contexts/RBACContext', () => ({
  useRBAC: () => ({ hasPermission: (p: string) => hasPermissionMock(p), isAdmin: false, permissions: [] }),
}))
vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ showToast: showToastMock, success: showToastMock, error: showToastMock, warning: showToastMock, info: showToastMock }),
}))
// VendorLogo loads SVGs from /images/vendors; not what this suite is about.
vi.mock('./VendorLogo', () => ({ default: () => null }))

import ImageCatalogTab from './ImageCatalogTab'

const meta = {
  source: 'remote', catalogUpdatedAt: '2026-10-01', fetchedAt: '2026-09-05T10:00:00.000Z',
  lastCheckedAt: '2026-09-05T10:00:00.000Z', lastResult: 'updated', lastError: null,
  url: 'https://raw.githubusercontent.com/x', autoUpdate: true,
}

const baseImage = {
  slug: 'ubuntu-2404', name: 'Ubuntu 24.04 LTS', vendor: 'ubuntu', version: '24.04', arch: 'amd64', format: 'qcow2',
  downloadUrl: 'https://img.test/u.img', checksumUrl: null, defaultDiskSize: '20G', minMemory: 512, recommendedMemory: 2048,
  minCores: 1, recommendedCores: 2, ostype: 'l26', tags: ['lts'], logoIcon: 'ri-ubuntu-fill', isCustom: false, isShared: true,
}

const catalogBody = (m: typeof meta | Record<string, unknown>, imageOver: Record<string, unknown> = {}) => ({
  data: {
    images: [{ ...baseImage, ...imageOver }],
    vendors: [{ id: 'ubuntu', name: 'Ubuntu', icon: 'ri-ubuntu-fill' }],
    meta: m,
  },
})

/** Several images in one payload, each one an override of the base image. */
const multiVersionBody = (m: typeof meta | Record<string, unknown>, overrides: Record<string, unknown>[]) => {
  const images = overrides.map(o => ({ ...baseImage, ...o }))
  const vendorIds = [...new Set(images.map(i => String(i.vendor)))]

  return {
    data: {
      images,
      vendors: vendorIds.map(id => ({ id, name: id.charAt(0).toUpperCase() + id.slice(1), icon: 'ri-cloud-line' })),
      meta: m,
    },
  }
}

function stubFetch(handlers: { catalog: () => unknown; refresh?: () => unknown }) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/api/v1/templates/catalog/refresh') && init?.method === 'POST') {
      return new Response(JSON.stringify(handlers.refresh?.() ?? {}), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (url.endsWith('/api/v1/templates/catalog')) {
      return new Response(JSON.stringify(handlers.catalog()), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  tenantState.id = 'default'
  tenantState.loading = false
  hasPermissionMock.mockReset().mockReturnValue(true)
  showToastMock.mockReset()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ImageCatalogTab catalog status', () => {
  it('shows the catalog date and the last check for a remote catalog', async () => {
    stubFetch({ catalog: () => catalogBody(meta) })
    renderWithProviders(<ImageCatalogTab onDeploy={() => {}} />)
    await screen.findByRole('heading', { name: 'Ubuntu' })
    // The status lives in the refresh button's tooltip, not inline.
    expect(screen.queryByText(/Catalog from 2026-10-01/)).toBeNull()
    await userEvent.hover(screen.getByRole('button', { name: /check for updates/i }))
    expect(await screen.findByText(/Catalog from 2026-10-01, checked /)).toBeTruthy()
    expect(screen.queryByTitle(/remote catalog could not be fetched/i)).toBeNull()
  })

  it('shows the fallback warning when the embedded catalog serves after an error', async () => {
    stubFetch({ catalog: () => catalogBody({ ...meta, source: 'embedded', lastResult: 'error', lastError: 'HTTP 503 from x', lastCheckedAt: '2026-09-05T10:00:00.000Z' }) })
    renderWithProviders(<ImageCatalogTab onDeploy={() => {}} />)
    await screen.findByRole('heading', { name: 'Ubuntu' })
    expect(screen.getByLabelText(/remote catalog could not be fetched/i)).toBeTruthy()
  })

  it('warns that a refresh failed even while the stored remote catalog keeps serving', async () => {
    // source stays 'remote' once a valid catalog is stored, so keying the
    // warning on the fallback would hide every background failure.
    stubFetch({ catalog: () => catalogBody({ ...meta, lastResult: 'error', lastError: 'HTTP 503 from x' }) })
    renderWithProviders(<ImageCatalogTab onDeploy={() => {}} />)
    await screen.findByRole('heading', { name: 'Ubuntu' })

    const warning = screen.getByLabelText(/last refresh failed/i)
    expect(warning).toBeTruthy()
    // And it does not claim the embedded catalog took over, which it did not.
    expect(screen.queryByLabelText(/catalog embedded in this release is shown/i)).toBeNull()
  })

  it('says the catalog was never checked when there is no status yet', async () => {
    stubFetch({ catalog: () => catalogBody({ ...meta, source: 'embedded', lastCheckedAt: null, lastResult: null, fetchedAt: null }) })
    renderWithProviders(<ImageCatalogTab onDeploy={() => {}} />)
    await screen.findByRole('heading', { name: 'Ubuntu' })
    await userEvent.hover(screen.getByRole('button', { name: /check for updates/i }))
    expect(await screen.findByText(/not checked yet/)).toBeTruthy()
  })

  it('keeps the status inline for a user who cannot refresh', async () => {
    stubFetch({ catalog: () => catalogBody(meta) })
    hasPermissionMock.mockReturnValue(false)
    renderWithProviders(<ImageCatalogTab onDeploy={() => {}} />)
    await screen.findByRole('heading', { name: 'Ubuntu' })
    expect(screen.queryByRole('button', { name: /check for updates/i })).toBeNull()
    expect(screen.getByText(/Catalog from 2026-10-01, checked /)).toBeTruthy()
  })
})

describe('ImageCatalogTab check for updates', () => {
  it('lets the provider admin refresh and toasts the diff, then reloads the catalog', async () => {
    let calls = 0
    const fetchMock = stubFetch({
      catalog: () => { calls++; return catalogBody(meta) },
      refresh: () => ({ data: { result: 'updated', added: ['ubuntu-2610'], updated: ['fedora-43'], removed: [], error: null, meta } }),
    })
    renderWithProviders(<ImageCatalogTab onDeploy={() => {}} />)
    await screen.findByRole('heading', { name: 'Ubuntu' })
    expect(calls).toBe(1)

    await userEvent.click(screen.getByRole('button', { name: /check for updates/i }))

    await waitFor(() => expect(showToastMock).toHaveBeenCalledWith('Image catalog updated: 1 new, 1 changed, 0 removed', 'success'))
    await waitFor(() => expect(calls).toBe(2))
    expect(fetchMock.mock.calls.some(([u, i]) => String(u).endsWith('/catalog/refresh') && (i as RequestInit)?.method === 'POST')).toBe(true)
  })

  it('toasts "up to date" on an unchanged result and the error message on a failed one', async () => {
    let result: Record<string, unknown> = { result: 'unchanged', added: [], updated: [], removed: [], error: null, meta }
    stubFetch({ catalog: () => catalogBody(meta), refresh: () => ({ data: result }) })
    renderWithProviders(<ImageCatalogTab onDeploy={() => {}} />)
    await screen.findByRole('heading', { name: 'Ubuntu' })

    await userEvent.click(screen.getByRole('button', { name: /check for updates/i }))
    await waitFor(() => expect(showToastMock).toHaveBeenCalledWith('The image catalog is up to date', 'info'))

    result = { result: 'error', added: [], updated: [], removed: [], error: 'HTTP 503 from x', meta }
    await userEvent.click(screen.getByRole('button', { name: /check for updates/i }))
    await waitFor(() => expect(showToastMock).toHaveBeenCalledWith('Image catalog refresh failed: HTTP 503 from x', 'error'))
  })

  it('hides the button for a tenant and for a provider user without admin.settings', async () => {
    stubFetch({ catalog: () => catalogBody(meta) })
    tenantState.id = 'acme'
    const { unmount } = renderWithProviders(<ImageCatalogTab onDeploy={() => {}} />)
    await screen.findByRole('heading', { name: 'Ubuntu' })
    expect(screen.queryByRole('button', { name: /check for updates/i })).toBeNull()
    unmount()

    tenantState.id = 'default'
    hasPermissionMock.mockReturnValue(false)
    renderWithProviders(<ImageCatalogTab onDeploy={() => {}} />)
    await screen.findByRole('heading', { name: 'Ubuntu' })
    expect(screen.queryByRole('button', { name: /check for updates/i })).toBeNull()
    expect(hasPermissionMock).toHaveBeenCalledWith('admin.settings')
  })
})

describe('ImageCatalogTab image build identity', () => {
  it('shows the point release and the build date resolved from the mirror', async () => {
    stubFetch({ catalog: () => catalogBody(meta, { release: '9.8', buildDate: '2026-05-25' }) })
    renderWithProviders(<ImageCatalogTab onDeploy={() => {}} />)
    await screen.findByRole('heading', { name: 'Ubuntu' })
    expect(screen.getByText(/qcow2 . 9\.8/)).toBeTruthy()
    // The date sits in the spec row next to cores and RAM; the wording that
    // says what it is lives in its tooltip.
    await userEvent.hover(screen.getByText(/2026/))
    expect(await screen.findByText(/Image from/)).toBeTruthy()
  })

  it('leaves the card as it was when the probe resolved nothing', async () => {
    stubFetch({ catalog: () => catalogBody(meta) })
    renderWithProviders(<ImageCatalogTab onDeploy={() => {}} />)
    await screen.findByRole('heading', { name: 'Ubuntu' })
    expect(screen.queryByText(/Image from/)).toBeNull()
    expect(screen.getByText(/amd64 . qcow2/)).toBeTruthy()
  })
})

describe('ImageCatalogTab version picker', () => {
  it('collapses the versions of one distribution into a single card, newest preselected', async () => {
    stubFetch({ catalog: () => multiVersionBody(meta, [
      { slug: 'ubuntu-2204', name: 'Ubuntu 22.04 LTS', version: '22.04', buildDate: '2024-01-02' },
      { slug: 'ubuntu-2404', name: 'Ubuntu 24.04 LTS', version: '24.04', buildDate: '2026-08-26' },
    ]) })
    renderWithProviders(<ImageCatalogTab onDeploy={() => {}} />)

    // The card is titled with the distribution, not with an image name.
    expect(await screen.findByRole('heading', { name: 'Ubuntu' })).toBeTruthy()
    expect(screen.queryByText('Ubuntu 22.04 LTS')).toBeNull()
    // Newest wins even though the payload lists it second.
    expect(screen.getByRole('button', { name: 'Version' }).textContent).toBe('24.04')
  })

  it('orders versions numerically rather than as text', async () => {
    stubFetch({ catalog: () => multiVersionBody(meta, [
      { slug: 'rocky-9', name: 'Rocky Linux 9', vendor: 'rocky', version: '9' },
      { slug: 'rocky-10', name: 'Rocky Linux 10', vendor: 'rocky', version: '10' },
    ]) })
    renderWithProviders(<ImageCatalogTab onDeploy={() => {}} />)
    await screen.findByRole('heading', { name: 'Rocky' })

    expect(screen.getByRole('button', { name: 'Version' }).textContent).toBe('10')
  })

  it('switches the card to the picked version and deploys that one', async () => {
    const onDeploy = vi.fn()
    stubFetch({ catalog: () => multiVersionBody(meta, [
      { slug: 'ubuntu-2404', name: 'Ubuntu 24.04 LTS', version: '24.04', buildDate: '2026-08-26', defaultDiskSize: '20G' },
      { slug: 'ubuntu-2204', name: 'Ubuntu 22.04 LTS', version: '22.04', buildDate: '2024-01-02', defaultDiskSize: '15G' },
    ]) })
    renderWithProviders(<ImageCatalogTab onDeploy={onDeploy} />)
    await screen.findByRole('heading', { name: 'Ubuntu' })
    expect(screen.getByText('20G')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Version' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Ubuntu 22.04 LTS' }))

    // The whole card follows the selection, not just the label.
    expect(screen.getByRole('button', { name: 'Version' }).textContent).toBe('22.04')
    expect(screen.getByText('15G')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /deploy/i }))
    expect(onDeploy).toHaveBeenCalledTimes(1)
    expect(onDeploy.mock.calls[0][0].slug).toBe('ubuntu-2204')
  })

  it('shows no picker when the distribution has a single version', async () => {
    stubFetch({ catalog: () => catalogBody(meta) })
    renderWithProviders(<ImageCatalogTab onDeploy={() => {}} />)
    await screen.findByRole('heading', { name: 'Ubuntu' })

    expect(screen.queryByRole('button', { name: 'Version' })).toBeNull()
  })

  it('leaves a single version selected when the search narrows the group', async () => {
    stubFetch({ catalog: () => multiVersionBody(meta, [
      { slug: 'ubuntu-2404', name: 'Ubuntu 24.04 LTS', version: '24.04' },
      { slug: 'ubuntu-2204', name: 'Ubuntu 22.04 LTS', version: '22.04' },
    ]) })
    renderWithProviders(<ImageCatalogTab onDeploy={() => {}} />)
    await screen.findByRole('heading', { name: 'Ubuntu' })

    await userEvent.type(screen.getByPlaceholderText(/search/i), '22.04')

    expect(await screen.findByText('22.04')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Version' })).toBeNull()
  })
})
