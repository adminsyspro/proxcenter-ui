import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, within } from '@testing-library/react'
import { renderWithProviders, screen, userEvent, waitFor } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ currentTenant: { id: 'default', name: 'Provider' }, loading: false, isFullClusterView: true }) }))
vi.mock('@/contexts/RBACContext', () => ({ useRBAC: () => ({ hasPermission: () => true, hasPermissionOn: () => true, isAdmin: true, permissions: [] }) }))
vi.mock('./DeploymentProgress', () => ({ default: () => <div>Deployment started</div> }))
import DeployWizard from './DeployWizard'

const image = {
  slug: 'test-cloud', name: 'Test cloud image', vendor: 'debian', version: '13', arch: 'amd64',
  format: 'qcow2', downloadUrl: '', checksumUrl: null, defaultDiskSize: '20G', minMemory: 128,
  recommendedMemory: 2048, minCores: 1, recommendedCores: 2, ostype: 'l26', tags: [],
} as any
const acmeVdc = {
  id: 'vdc-acme', name: 'DC A', tenantName: 'Acme', connectionId: 'conn-b', enabled: true, nodes: ['pve2'],
  storages: ['ceph'], quota: { maxStorageMb: null }, storagePolicies: [],
  usage: { usedVcpus: 0, usedRamMb: 0, usedVms: 0, usedStorageMb: 0, usedStorageByStorage: {} },
}
const disabledVdc = { ...acmeVdc, id: 'vdc-off', name: 'DC Off', enabled: false }

let posted: any = null
let scoped: string[] = []
function seed(options: { adminVdcs?: () => Response } = {}) {
  const track = (request: Request) => {
    const url = new URL(request.url)
    if (url.searchParams.get('targetVdcId')) scoped.push(`${url.pathname}?${url.searchParams.get('targetVdcId')}`)
  }
  server.use(
    http.get('*/api/v1/connections', () => HttpResponse.json({ data: [{ id: 'conn-a', name: 'PVE-A' }, { id: 'conn-b', name: 'PVE-B' }] })),
    http.get('*/api/v1/admin/vdcs', () => options.adminVdcs?.() ?? HttpResponse.json({ data: [acmeVdc, disabledVdc] })),
    http.get('*/api/v1/vdcs', ({ request }) => {
      track(request)
      return HttpResponse.json({ data: new URL(request.url).searchParams.get('targetVdcId') ? [acmeVdc] : [] })
    }),
    http.get('*/api/v1/connections/:id/nodes', () => HttpResponse.json({ data: [
      { node: 'pve1', status: 'online', cpu: 0.1, maxcpu: 4, mem: 1, maxmem: 10 },
      { node: 'pve2', status: 'online', cpu: 0.1, maxcpu: 4, mem: 1, maxmem: 10 },
    ] })),
    http.get('*/api/v1/connections/:id/cluster/nextid', ({ request }) => { track(request); return HttpResponse.json({ data: 4100 }) }),
    http.get('*/api/v1/connections/:id/network-choices', ({ request }) => {
      track(request)
      return HttpResponse.json({ data: [{ name: 'vnet1', kind: 'vnet', displayName: 'lan', vdcId: 'vdc-acme' }] })
    }),
    http.get('*/api/v1/connections/:id/nodes/:node/storages', ({ request }) => {
      track(request)
      if (new URL(request.url).searchParams.get('content') === 'iso') return HttpResponse.json({ data: [] })
      return HttpResponse.json({ data: [{ storage: 'ceph', type: 'rbd', content: 'images', active: 1, enabled: 1, shared: 1, avail: 0, total: 0 }] })
    }),
    http.post('*/api/v1/templates/deploy', async ({ request }) => {
      posted = await request.json()
      return HttpResponse.json({ data: { deploymentId: 'deployment-65', vmid: 4100 } })
    }),
  )
}
const destination = () => screen.findByRole('combobox', { name: 'Destination' })
async function toTarget() {
  await userEvent.click(screen.getByRole('button', { name: 'Next' }))
  return destination()
}

beforeEach(() => { posted = null; scoped = [] })
afterEach(cleanup)

describe('DeployWizard provider destination (roadmap#65)', () => {
  it('defaults to the provider infrastructure and only offers enabled tenant vDCs', async () => {
    seed()
    renderWithProviders(<DeployWizard open image={image} onClose={() => {}} />)
    const select = await toTarget()
    expect(select).toHaveTextContent('Provider infrastructure (no vDC)')
    await userEvent.click(select)
    const options = within(await screen.findByRole('listbox'))
    expect(options.getByRole('option', { name: /Provider infrastructure/ })).toBeInTheDocument()
    expect(options.getByRole('option', { name: /Acme \/ DC A/ })).toBeInTheDocument()
    expect(options.queryByRole('option', { name: /DC Off/ })).toBeNull()
    expect(scoped).toEqual([])
  })

  it('locks the connection, reads as the vDC tenant and sends targetVdcId', async () => {
    seed()
    renderWithProviders(<DeployWizard open image={image} onClose={() => {}} />)
    await userEvent.click(await toTarget())
    await userEvent.click(await screen.findByRole('option', { name: /Acme \/ DC A/ }))
    await screen.findByText(/The VM is created in the DC A vDC of Acme/)
    await waitFor(() => expect(scoped).toEqual(expect.arrayContaining([
      '/api/v1/connections/conn-b/nodes/pve2/storages?vdc-acme',
      '/api/v1/connections/conn-b/cluster/nextid?vdc-acme',
      '/api/v1/vdcs?vdc-acme',
    ])))
    expect(screen.getByRole('combobox', { name: 'Destination' })).toHaveTextContent('Acme / DC A')
    await userEvent.type(screen.getByLabelText('VM Name'), 'provider-into-vdc')
    for (let step = 0; step < 3; step++) {
      const next = screen.getByRole('button', { name: 'Next' })
      await waitFor(() => expect(next).toBeEnabled())
      await userEvent.click(next)
    }
    expect(await screen.findByText('Destination: Acme / DC A')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Deploy Now' }))
    await waitFor(() => expect(posted?.targetVdcId).toBe('vdc-acme'))
    expect(posted).toMatchObject({ connectionId: 'conn-b', node: 'pve2', storage: 'ceph' })
    // The full-cluster view would keep its vmbr0 default; the vDC rules move
    // the bridge onto one of the vDC networks.
    expect(posted.hardware.networkBridge).toBe('vnet1')
    expect(scoped).toContain('/api/v1/connections/conn-b/network-choices?vdc-acme')
  })

  it('switching back to the provider infrastructure drops the target', async () => {
    seed()
    renderWithProviders(<DeployWizard open image={image} onClose={() => {}} />)
    await userEvent.click(await toTarget())
    await userEvent.click(await screen.findByRole('option', { name: /Acme \/ DC A/ }))
    await screen.findByText(/The VM is created in the DC A vDC of Acme/)
    await userEvent.click(screen.getByRole('combobox', { name: 'Destination' }))
    await userEvent.click(await screen.findByRole('option', { name: /Provider infrastructure/ }))
    await waitFor(() => expect(screen.queryByText(/The VM is created in/)).toBeNull())
    expect(screen.getByRole('combobox', { name: 'Destination' })).toHaveTextContent('Provider infrastructure (no vDC)')
  })

  it('a retry lands in the same vDC, and falls back to the provider when that vDC is gone', async () => {
    seed()
    const retry = (targetVdcId: string) => ({ hardware: null, cloudInit: null, _retryFrom: { connectionId: 'conn-b', node: 'pve2', storage: 'ceph', vmName: 'again', targetVdcId } })
    const view = renderWithProviders(<DeployWizard open image={image} prefillBlueprint={retry('vdc-acme')} onClose={() => {}} />)
    await waitFor(async () => expect(await toTarget()).toHaveTextContent('Acme / DC A'))
    view.unmount()
    renderWithProviders(<DeployWizard open image={image} prefillBlueprint={retry('vdc-gone')} onClose={() => {}} />)
    await waitFor(async () => expect(await toTarget()).toHaveTextContent('Provider infrastructure (no vDC)'))
  })

  it('hides the picker when the caller cannot list vDCs', async () => {
    seed({ adminVdcs: () => HttpResponse.json({ error: 'Forbidden' }, { status: 403 }) })
    renderWithProviders(<DeployWizard open image={image} onClose={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('Connection')
    expect(screen.queryByRole('combobox', { name: 'Destination' })).toBeNull()
  })
})
