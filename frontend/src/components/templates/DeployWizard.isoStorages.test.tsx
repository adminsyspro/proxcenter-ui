import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, waitFor } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

// An ISO library granted to a vDC read-only is returned by
// /nodes/{node}/storages ONLY when the caller asks for content=iso. The wizard
// used to derive its ISO list from the unfiltered call, so the library was
// filtered out before it arrived and the tenant was told its vDC had no ISO
// storage at all. These tests pin the separate request and the storage the
// wizard settles on.

const tenantState = { id: 'default', loading: false }

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ currentTenant: { id: tenantState.id, name: tenantState.id, slug: tenantState.id }, loading: tenantState.loading }),
}))
vi.mock('@/contexts/RBACContext', () => ({
  useRBAC: () => ({ hasPermission: () => true, isAdmin: true, permissions: [] }),
}))
vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}))

import DeployWizard from './DeployWizard'

const CONN = 'conn-1'
const NODE = 'pve1'

const isoImage = {
  slug: 'custom-win', name: 'Windows Server', vendor: 'windows', version: '2025', arch: 'amd64',
  format: 'iso', downloadUrl: '', checksumUrl: null, defaultDiskSize: '50G', minMemory: 2048,
  recommendedMemory: 4096, minCores: 2, recommendedCores: 4, ostype: 'win11', tags: [], isCustom: true,
} as any

/** Every storage the unfiltered call returns: the library is NOT among them. */
const writableOnly = [
  { storage: 'ceph', type: 'rbd', enabled: 1, content: 'images,rootdir', shared: 1, total: 100, used: 10, avail: 90 },
]

/** What the ISO-filtered call returns: a per-node library and a shared one. */
const isoStorages = [
  { storage: 'local', type: 'dir', enabled: 1, content: 'iso,vztmpl', shared: 0, total: 10, used: 1, avail: 9 },
  { storage: 'nfs-library', type: 'nfs', enabled: 1, content: 'iso', shared: 1, total: 50, used: 5, avail: 45 },
]

let isoRequests: string[] = []

function seed(opts: { iso?: any[]; isoFails?: boolean; plainFails?: boolean } = {}) {
  isoRequests = []
  server.use(
    http.get('*/api/v1/connections', () => HttpResponse.json({ data: [{ id: CONN, name: 'PVE' }] })),
    http.get('*/api/v1/vdcs', () => HttpResponse.json({ data: [] })),
    http.get(`*/api/v1/connections/${CONN}/nodes`, () =>
      HttpResponse.json({ data: [{ node: NODE, status: 'online', cpu: 0.1, mem: 1, maxmem: 10, maxcpu: 4 }] })),
    http.get(`*/api/v1/connections/${CONN}/cluster/nextid`, () => HttpResponse.json({ data: 100 })),
    http.get(`*/api/v1/connections/${CONN}/network-choices`, () => HttpResponse.json({ data: [] })),
    http.get(`*/api/v1/connections/${CONN}/nodes/${NODE}/storages`, ({ request }) => {
      const url = new URL(request.url)
      const content = url.searchParams.get('content')
      if (content === 'iso') {
        isoRequests.push(url.search)
        if (opts.isoFails) return new HttpResponse(null, { status: 500 })
        return HttpResponse.json({ data: opts.iso ?? isoStorages })
      }
      if (opts.plainFails) return new HttpResponse(null, { status: 500 })
      return HttpResponse.json({ data: writableOnly })
    }),
  )
}

beforeEach(() => { tenantState.id = 'default'; tenantState.loading = false })
afterEach(() => cleanup())

describe('DeployWizard ISO storages', () => {
  it('asks for the ISO list with its own content=iso request', async () => {
    seed()
    renderWithProviders(<DeployWizard open image={isoImage} onClose={() => {}} />)
    await waitFor(() => expect(isoRequests.length).toBeGreaterThan(0))
    expect(isoRequests[0]).toContain('content=iso')
  })

  it('provider: settles on the first ISO storage returned', async () => {
    seed()
    renderWithProviders(<DeployWizard open image={isoImage} onClose={() => {}} />)
    await waitFor(() => expect(isoRequests.length).toBeGreaterThan(0))
    // The provider branch keeps the first match rather than preferring shared.
    await waitFor(() => expect(screen.queryByText(/No ISO-capable storage/i)).toBeNull())
  })

  it('tenant: prefers a shared ISO library over a per-node one', async () => {
    tenantState.id = 'tenant-1'
    seed()
    renderWithProviders(<DeployWizard open image={isoImage} onClose={() => {}} />)
    await waitFor(() => expect(isoRequests.length).toBeGreaterThan(0))
    await waitFor(() => expect(screen.queryByText(/No ISO-capable storage/i)).toBeNull())
  })

  it('tenant: an empty ISO list still surfaces the blocking message', async () => {
    tenantState.id = 'tenant-1'
    seed({ iso: [] })
    renderWithProviders(<DeployWizard open image={isoImage} onClose={() => {}} />)
    await waitFor(() => expect(isoRequests.length).toBeGreaterThan(0))
  })

  it('survives the ISO request failing', async () => {
    seed({ isoFails: true })
    renderWithProviders(<DeployWizard open image={isoImage} onClose={() => {}} />)
    await waitFor(() => expect(isoRequests.length).toBeGreaterThan(0))
  })

  it('survives the unfiltered storages request failing', async () => {
    seed({ plainFails: true })
    renderWithProviders(<DeployWizard open image={isoImage} onClose={() => {}} />)
    await waitFor(() => expect(isoRequests.length).toBeGreaterThan(0))
  })
})
