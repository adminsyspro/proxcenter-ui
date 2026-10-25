/**
 * CreateVmDialog for a vDC tenant (#1171): the VM goes in one of the tenant's
 * vDCs open to blank VMs, the storages come from the vDC-scoped node route,
 * the ISO libraries stay out of the disk picker and the tenant may upload its
 * own ISO. The confirm step names the vDC, never the node nor the VMID.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, within } from '@testing-library/react'
import {
  renderWithProviders,
  screen,
  waitFor,
  fireEvent,
} from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

import { connections, networkChoices } from '@/__tests__/fixtures/pveProvisioning'

import CreateVmDialog, { vdcNodePool, loadTenantNodeStorages } from './CreateVmDialog'

vi.mock('@/contexts/RBACContext', () => ({
  useRBAC: () => ({ isAdmin: false }),
}))

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({
    currentTenant: { id: 't1', slug: 'acme', name: 'Acme' },
    loading: false,
    isFullClusterView: false,
  }),
}))

const CONN_ID = connections[0].id

const TWO_NODES = [
  { node: 'pve1', status: 'online', cpu: 0.8, maxcpu: 4, mem: 7 * 1024 ** 3, maxmem: 8 * 1024 ** 3 },
  { node: 'pve2', status: 'online', cpu: 0.05, maxcpu: 4, mem: 1 * 1024 ** 3, maxmem: 8 * 1024 ** 3 },
]

const vdc = (over: Record<string, unknown>) => ({
  id: 'vdc-a', name: 'Alpha', connectionId: CONN_ID, enabled: true, allowBlankVms: true, nodes: [], ...over,
})

// Node route rows: the vDC primary storage, and an ISO library the tenant may upload to.
const MAIN_STORAGES = [{ storage: 'ceph', type: 'rbd', content: 'images,rootdir', shared: 1, tenantCanUpload: false }]
const ISO_STORAGES = [{ storage: 'lib', type: 'dir', content: 'iso,images', shared: 0, tenantCanUpload: true }]

let nextidCalls: number
let bridgeNodes: string[]
let clusterStorageCalls: number

function seed(vdcs: unknown[]) {
  server.use(
    http.get('*/api/v1/connections', () => HttpResponse.json({ data: connections })),
    http.get(`*/api/v1/connections/${CONN_ID}/nodes`, () => HttpResponse.json({ data: TWO_NODES })),
    http.get(`*/api/v1/connections/${CONN_ID}/cluster/nextid`, () => {
      nextidCalls++

      return HttpResponse.json({ data: 101 })
    }),
    http.get('*/api/v1/vdcs', () => HttpResponse.json({ data: vdcs })),
    http.get(`*/api/v1/connections/${CONN_ID}/pools`, () => HttpResponse.json({ data: [] })),
    http.get(`*/api/v1/connections/${CONN_ID}/storage`, () => {
      clusterStorageCalls++

      return HttpResponse.json({ data: [] })
    }),
    http.get(`*/api/v1/connections/${CONN_ID}/nodes/:node/storages`, ({ request }) =>
      HttpResponse.json({ data: new URL(request.url).searchParams.get('content') === 'iso' ? ISO_STORAGES : MAIN_STORAGES }),
    ),
    http.get(`*/api/v1/connections/${CONN_ID}/network-choices`, ({ request }) => {
      bridgeNodes.push(new URL(request.url).searchParams.get('node') ?? '')

      return HttpResponse.json({ data: networkChoices })
    }),
    http.get(`*/api/v1/connections/${CONN_ID}/nodes/:node/storage/:storage/content`, () => HttpResponse.json({ data: [] })),
    http.get(`*/api/v1/connections/${CONN_ID}/nodes/:node/cpu-models`, () => HttpResponse.json({ data: [] })),
  )
}

const props = () => ({ open: true, onClose: vi.fn(), allVms: [] })

beforeEach(() => {
  nextidCalls = 0
  bridgeNodes = []
  clusterStorageCalls = 0
})

afterEach(() => {
  cleanup()
})

describe('CreateVmDialog - vDC tenant blank VMs (#1171)', () => {
  it('has no target when none of the vDCs allows blank VMs', async () => {
    seed([vdc({ allowBlankVms: false })])
    renderWithProviders(<CreateVmDialog {...props()} />)

    expect(await screen.findByText(/None of your vDCs allows blank VMs/)).toBeInTheDocument()
    expect(nextidCalls).toBe(0)
    expect(screen.queryByLabelText('Select vDC')).not.toBeInTheDocument()
  })

  it('places the VM on the vDC nodes only, without asking when one vDC qualifies', async () => {
    // The least-loaded node is pve2, but the vDC pins pve1.
    seed([vdc({ nodes: ['pve1'] }), vdc({ id: 'vdc-b', name: 'Beta', allowBlankVms: false })])
    renderWithProviders(<CreateVmDialog {...props()} />)

    await waitFor(() => expect(bridgeNodes).toContain('pve1'))
    expect(bridgeNodes).not.toContain('pve2')
    expect(nextidCalls).toBe(1)
    expect(screen.queryByLabelText('Select vDC')).not.toBeInTheDocument()
  })

  it('asks for the vDC when two qualify and moves the VM when another is picked', async () => {
    seed([vdc({ nodes: ['pve1'] }), vdc({ id: 'vdc-b', name: 'Beta', nodes: ['pve2'] })])
    renderWithProviders(<CreateVmDialog {...props()} />)

    await waitFor(() => expect(bridgeNodes).toContain('pve1'))
    const picker = await screen.findByLabelText('Select vDC')
    expect(picker.textContent).toContain('Alpha')

    fireEvent.mouseDown(picker)
    fireEvent.click(await screen.findByRole('option', { name: 'Beta' }))

    await waitFor(() => expect(bridgeNodes).toContain('pve2'))
    await waitFor(() => expect(screen.getByLabelText('Select vDC').textContent).toContain('Beta'))
  })

  it('warns when the vDC has no node to place the VM on', async () => {
    seed([vdc({ nodes: ['pve9'] })])
    renderWithProviders(<CreateVmDialog {...props()} />)

    expect(await screen.findByText(/No node of this vDC is available/)).toBeInTheDocument()
    expect(nextidCalls).toBe(0)
  })

  it('reads storages from the node route, keeps ISO libraries off the disks and offers the upload', async () => {
    seed([vdc({})])
    renderWithProviders(<CreateVmDialog {...props()} />)
    await waitFor(() => expect(nextidCalls).toBe(1))

    fireEvent.click(screen.getByRole('tab', { name: 'OS' }))
    expect(await screen.findByRole('button', { name: /Upload ISO/ })).toBeInTheDocument()
    // The node name is not shown to a tenant next to a per-node storage.
    expect(screen.getAllByRole('combobox')[0].textContent).toBe('lib (dir)')

    fireEvent.click(screen.getByRole('tab', { name: 'Disks' }))
    await waitFor(() => expect(screen.getByText('ceph')).toBeInTheDocument())
    expect(screen.queryByText('lib')).not.toBeInTheDocument()
    expect(clusterStorageCalls).toBe(0)
  })

  it('names the vDC on the confirm step, not the node nor the VMID', async () => {
    seed([vdc({})])
    renderWithProviders(<CreateVmDialog {...props()} />)
    await waitFor(() => expect(nextidCalls).toBe(1))

    fireEvent.click(screen.getByRole('tab', { name: 'Confirm' }))
    const summary = await screen.findByTestId('create-vm-summary')
    expect(within(summary).getByText('vDC')).toBeInTheDocument()
    expect(within(summary).getByText('Alpha')).toBeInTheDocument()
    expect(within(summary).queryByText('Node')).not.toBeInTheDocument()
    expect(summary.textContent).not.toMatch(/pve\d/)
  })
})

describe('vdcNodePool', () => {
  const nodes = [
    { node: 'pve1', connId: 'conn-1' },
    { node: 'pve2', connId: 'conn-1' },
    { node: 'pve1', connId: 'conn-2' },
  ]

  it('keeps the nodes of the vDC connection, all of them without a pinned list', () => {
    expect(vdcNodePool({ connectionId: 'conn-1' }, nodes)).toHaveLength(2)
    expect(vdcNodePool({ connection_id: 'conn-2', nodes: [] }, nodes)).toEqual([{ node: 'pve1', connId: 'conn-2' }])
  })

  it('narrows to the pinned nodes', () => {
    expect(vdcNodePool({ connectionId: 'conn-1', nodes: ['pve2'] }, nodes)).toEqual([{ node: 'pve2', connId: 'conn-1' }])
  })
})

describe('loadTenantNodeStorages', () => {
  it('merges the ISO listing, flagging what only it returns and carrying the upload right', async () => {
    server.use(
      http.get('*/api/v1/connections/c/nodes/n/storages', ({ request }) =>
        HttpResponse.json({
          data: new URL(request.url).searchParams.get('content') === 'iso'
            ? [{ storage: 'local', content: 'iso', tenantCanUpload: true }, { storage: 'lib', content: 'iso' }]
            : [{ storage: 'local', content: 'iso,images', tenantCanUpload: false }],
        }),
      ),
    )

    expect(await loadTenantNodeStorages('c', 'n')).toEqual([
      { storage: 'local', content: 'iso,images', tenantCanUpload: true, node: 'n' },
      { storage: 'lib', content: 'iso', node: 'n', isoOnly: true },
    ])
  })

  it('treats a refused or broken listing as empty', async () => {
    server.use(
      http.get('*/api/v1/connections/c/nodes/n/storages', ({ request }) =>
        new URL(request.url).searchParams.get('content') === 'iso'
          ? HttpResponse.json({ error: 'no' }, { status: 403 })
          : HttpResponse.error(),
      ),
    )

    expect(await loadTenantNodeStorages('c', 'n')).toEqual([])
  })
})
