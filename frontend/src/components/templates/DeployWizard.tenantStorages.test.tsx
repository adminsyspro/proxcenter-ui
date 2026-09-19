import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, within } from '@testing-library/react'
import { renderWithProviders, screen, userEvent, waitFor } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ currentTenant: { id: 'tenant-storage', name: 'Tenant' }, loading: false, isFullClusterView: false }) }))
vi.mock('@/contexts/RBACContext', () => ({ useRBAC: () => ({ hasPermission: () => true, isAdmin: false, permissions: [] }) }))
vi.mock('./DeploymentProgress', () => ({ default: () => <div>Deployment started</div> }))
import DeployWizard from './DeployWizard'

const image = {
  slug: 'test-cloud', name: 'Test cloud image', vendor: 'debian', version: '13', arch: 'amd64',
  format: 'qcow2', downloadUrl: '', checksumUrl: null, defaultDiskSize: '20G', minMemory: 128,
  recommendedMemory: 2048, minCores: 1, recommendedCores: 2, ostype: 'l26', tags: [],
} as any
const vdcA = {
  id: 'vdc-a', name: 'DC A', connectionId: 'conn-a', enabled: true,
  storages: ['fast', 'archive'], quota: { maxStorageMb: null },
  storagePolicies: [
    { name: 'Gold', storageId: 'fast', quotaMb: 102400 },
    { name: 'Archive', storageId: 'archive', quotaMb: null },
  ],
  usage: { usedVcpus: 0, usedRamMb: 0, usedVms: 0, usedStorageMb: 20480, usedStorageByStorage: { fast: 20480 } },
}
const diskStorages = [
  { storage: 'fast', type: 'rbd', content: 'images', active: 1, enabled: 1, shared: 1, policy: { name: 'Gold' } },
  { storage: 'archive', type: 'nfs', content: 'images,iso', active: 1, enabled: 1, shared: 1, policy: { name: 'Archive' } },
  { storage: 'iso-library', type: 'nfs', content: 'iso', active: 1, enabled: 1 },
  { storage: 'ct-only', type: 'zfspool', content: 'rootdir', active: 1, enabled: 1 },
  { storage: 'offline', type: 'rbd', content: 'images', active: 0, enabled: 1 },
  { storage: 'disabled', type: 'nfs', content: 'images', active: 1, enabled: false },
]
let posted: any = null
function seed(options: { vdcs?: any[]; disks?: (connection: string) => Response | Promise<Response> } = {}) {
  const vdcs = options.vdcs ?? [vdcA]
  server.use(
    http.get('*/api/v1/connections', () => HttpResponse.json({ data: vdcs.map(v => ({ id: v.connectionId, name: v.name })) })),
    http.get('*/api/v1/vdcs', () => HttpResponse.json({ data: vdcs })),
    http.get('*/api/v1/connections/:id/nodes', () => HttpResponse.json({ data: [{ node: 'pve1', status: 'online', cpu: 0.1, maxcpu: 4, mem: 1, maxmem: 10 }] })),
    http.get('*/api/v1/connections/:id/cluster/nextid', () => HttpResponse.json({ data: 101 })),
    http.get('*/api/v1/connections/:id/network-choices', () => HttpResponse.json({ data: [{ name: 'tenant-net', kind: 'vnet', displayName: 'Tenant network' }] })),
    http.get('*/api/v1/connections/:id/nodes/:node/storages', ({ request, params }) => {
      if (new URL(request.url).searchParams.get('content') === 'iso') return HttpResponse.json({ data: [{ storage: 'iso-library', type: 'nfs', content: 'iso', active: 1, enabled: 1 }] })
      return options.disks?.(String(params.id)) ?? HttpResponse.json({ data: diskStorages })
    }),
    http.post('*/api/v1/templates/deploy', async ({ request }) => {
      posted = await request.json()
      return HttpResponse.json({ data: { id: 'deployment-15', vmid: 101 } })
    }),
  )
}
async function target() {
  await userEvent.click(screen.getByRole('button', { name: 'Next' }))
  return screen.findByRole('combobox', { name: 'Storage' })
}
async function chooseStorage(name: RegExp) {
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Storage' })).not.toHaveAttribute('aria-disabled', 'true'))
  await userEvent.click(screen.getByRole('combobox', { name: 'Storage' }))
  await userEvent.click(await screen.findByRole('option', { name }))
}
beforeEach(() => { posted = null; document.cookie = 'pc_vdc_context=; Max-Age=0; path=/' })
afterEach(cleanup)

describe('DeployWizard tenant target storage', () => {
  it('offers writable active image storages with policy names and remaining or unlimited quota', async () => {
    seed()
    renderWithProviders(<DeployWizard open image={image} onClose={() => {}} />)
    const select = await target()
    await waitFor(() => expect(select).not.toHaveAttribute('aria-disabled', 'true'))
    await userEvent.click(select)
    const options = within(await screen.findByRole('listbox'))
    expect(await options.findByRole('option', { name: /fast.*Gold.*80.0 GB quota remaining/ })).toBeInTheDocument()
    expect(options.getByRole('option', { name: /archive.*Archive.*No storage quota/ })).toBeInTheDocument()
    expect(options.queryByRole('option', { name: /iso-library|ct-only|offline|disabled/ })).toBeNull()
  })

  it('keeps a valid explicit choice across refetch and sends it in the deployment request', async () => {
    seed()
    const view = renderWithProviders(<DeployWizard open image={image} onClose={() => {}} />)
    await target()
    await chooseStorage(/archive/)
    view.rerender(<DeployWizard open={false} image={image} onClose={() => {}} />)
    view.rerender(<DeployWizard open image={image} onClose={() => {}} />)
    const select = await target()
    await waitFor(() => expect(select).toHaveTextContent('archive'))
    await userEvent.type(screen.getByLabelText('VM Name'), 'tenant-storage-test')
    for (let step = 0; step < 3; step++) {
      const next = screen.getByRole('button', { name: 'Next' })
      await waitFor(() => expect(next).toBeEnabled())
      await userEvent.click(next)
    }
    await userEvent.click(screen.getByRole('button', { name: 'Deploy Now' }))
    await waitFor(() => expect(posted?.storage).toBe('archive'))
    expect(posted.connectionId).toBe('conn-a')
  })

  it('rejects a late storage response from the previously selected vDC and uses the new vDC quota', async () => {
    let release!: () => void
    const delayed = new Promise<void>(resolve => { release = resolve })
    const requests: string[] = []
    const vdcB = { ...vdcA, id: 'vdc-b', name: 'DC B', connectionId: 'conn-b', storagePolicies: [{ name: 'Silver', storageId: 'fast', quotaMb: 51200 }], usage: { ...vdcA.usage, usedStorageByStorage: { fast: 40960 } } }
    seed({ vdcs: [vdcA, vdcB], disks: async connection => {
      requests.push(connection)
      if (connection === 'conn-a') { await delayed; return HttpResponse.json({ data: [{ ...diskStorages[0], storage: 'stale-storage' }] }) }
      return HttpResponse.json({ data: [{ ...diskStorages[0], policy: { name: 'Silver' } }] })
    } })
    renderWithProviders(<DeployWizard open image={image} onClose={() => {}} />)
    await target()
    await waitFor(() => expect(requests).toContain('conn-a'))
    await userEvent.click(screen.getByRole('combobox', { name: 'Select vDC' }))
    await userEvent.click(await screen.findByRole('option', { name: 'DC B' }))
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Storage' })).toHaveTextContent('Silver'))
    await act(async () => release())
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Storage' })).toHaveTextContent('10.0 GB quota remaining'))
    expect(screen.queryByText('stale-storage')).toBeNull()
  })

  it('clears an unavailable selection on failed refetch and blocks advancing', async () => {
    let fail = false
    seed({ disks: () => fail ? new HttpResponse(null, { status: 503 }) : HttpResponse.json({ data: diskStorages }) })
    const view = renderWithProviders(<DeployWizard open image={image} onClose={() => {}} />)
    await target()
    await chooseStorage(/archive/)
    fail = true
    view.rerender(<DeployWizard open={false} image={image} onClose={() => {}} />)
    view.rerender(<DeployWizard open image={image} onClose={() => {}} />)
    await target()
    await userEvent.type(screen.getByLabelText('VM Name'), 'tenant-storage-test')
    await screen.findByText('No writable VM disk storage is available in this vDC.')
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Storage' })).not.toHaveTextContent('archive')
  })

  it('keeps the selected storage policy quota blocking on the hardware step', async () => {
    seed({ vdcs: [{ ...vdcA, storagePolicies: [{ name: 'Gold', storageId: 'fast', quotaMb: 25600 }] }] })
    renderWithProviders(<DeployWizard open image={image} onClose={() => {}} />)
    const select = await target()
    await waitFor(() => expect(select).toHaveTextContent('5.0 GB quota remaining'))
    await userEvent.type(screen.getByLabelText('VM Name'), 'tenant-storage-test')
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('Disk Size')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled())
  })
})
