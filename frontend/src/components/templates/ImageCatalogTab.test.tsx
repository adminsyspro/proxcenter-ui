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

const catalogBody = (m: typeof meta | Record<string, unknown>) => ({
  data: {
    images: [{
      slug: 'ubuntu-2404', name: 'Ubuntu 24.04 LTS', vendor: 'ubuntu', version: '24.04', arch: 'amd64', format: 'qcow2',
      downloadUrl: 'https://img.test/u.img', checksumUrl: null, defaultDiskSize: '20G', minMemory: 512, recommendedMemory: 2048,
      minCores: 1, recommendedCores: 2, ostype: 'l26', tags: ['lts'], logoIcon: 'ri-ubuntu-fill', isCustom: false, isShared: true,
    }],
    vendors: [{ id: 'ubuntu', name: 'Ubuntu', icon: 'ri-ubuntu-fill' }],
    meta: m,
  },
})

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
    await screen.findByText('Ubuntu 24.04 LTS')
    expect(screen.getByText(/Catalog from 2026-10-01/)).toBeTruthy()
    expect(screen.getByText(/checked /)).toBeTruthy()
    expect(screen.queryByTitle(/remote catalog could not be fetched/i)).toBeNull()
  })

  it('shows the fallback warning when the embedded catalog serves after an error', async () => {
    stubFetch({ catalog: () => catalogBody({ ...meta, source: 'embedded', lastResult: 'error', lastError: 'HTTP 503 from x', lastCheckedAt: '2026-09-05T10:00:00.000Z' }) })
    renderWithProviders(<ImageCatalogTab onDeploy={() => {}} />)
    await screen.findByText('Ubuntu 24.04 LTS')
    expect(screen.getByLabelText(/remote catalog could not be fetched/i)).toBeTruthy()
  })

  it('says the catalog was never checked when there is no status yet', async () => {
    stubFetch({ catalog: () => catalogBody({ ...meta, source: 'embedded', lastCheckedAt: null, lastResult: null, fetchedAt: null }) })
    renderWithProviders(<ImageCatalogTab onDeploy={() => {}} />)
    await screen.findByText('Ubuntu 24.04 LTS')
    expect(screen.getByText(/not checked yet/)).toBeTruthy()
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
    await screen.findByText('Ubuntu 24.04 LTS')
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
    await screen.findByText('Ubuntu 24.04 LTS')

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
    await screen.findByText('Ubuntu 24.04 LTS')
    expect(screen.queryByRole('button', { name: /check for updates/i })).toBeNull()
    unmount()

    tenantState.id = 'default'
    hasPermissionMock.mockReturnValue(false)
    renderWithProviders(<ImageCatalogTab onDeploy={() => {}} />)
    await screen.findByText('Ubuntu 24.04 LTS')
    expect(screen.queryByRole('button', { name: /check for updates/i })).toBeNull()
    expect(hasPermissionMock).toHaveBeenCalledWith('admin.settings')
  })
})
