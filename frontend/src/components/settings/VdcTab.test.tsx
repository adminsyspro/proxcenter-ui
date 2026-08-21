/**
 * Component tests for VdcTab.tsx — the multi-vDC create flow.
 *
 * Covers the P1 behaviours: the cluster picker only offers provider-pool
 * clusters the tenant doesn't cover yet, the "tenant already has vDCs"
 * banner, the derived "tenant — cluster" name/slug, and the optional
 * custom Name field (empty = derived fallback at submit time).
 *
 * Not covered here: the edit dialog (DataGrid row actions) and the PBS
 * draft binding — both ride on the same fetch plumbing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent, waitFor, within } from '@/__tests__/setup/renderWithProviders'
import VdcTab from '@/components/settings/VdcTab'

const TENANTS = [
  { id: 'default', name: 'Provider', slug: 'default' },
  { id: 't1', name: 'ACME', slug: 'acme' },
]

const CONNECTIONS = [
  { id: 'c1', name: 'paris', type: 'pve', inProviderPool: true },
  { id: 'c2', name: 'frankfurt', type: 'pve', inProviderPool: true },
  { id: 'c3', name: 'msp-own', type: 'pve', inProviderPool: false },
]

const EXISTING_VDC = {
  id: 'vdc-1',
  name: 'ACME — paris',
  slug: 'acme-paris',
  tenantId: 't1',
  connectionId: 'c1',
  nodes: ['pve1'],
  primaryStorage: 'shared-nfs',
  enabled: true,
  quota: {},
  usage: { usedVms: 0 },
  storagePolicies: [
    { policyId: 'sp1', name: 'gold', storageId: 'ceph-fast', iopsRd: null, iopsWr: null, mbpsRd: null, mbpsWr: null, quotaMb: 51200 },
  ],
}

const CONN_POLICIES = [
  { id: 'sp1', name: 'gold', storageId: 'ceph-fast', vdcCount: 1 },
  { id: 'sp2', name: 'bronze', storageId: 'nfs-slow', vdcCount: 0 },
]

let posted: any
let putBody: any

function jsonRes(body: any, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response
}

beforeEach(() => {
  posted = undefined
  putBody = undefined
  vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
    const url = String(input)

    if (url.endsWith('/api/v1/admin/vdcs') && init?.method === 'POST') {
      posted = JSON.parse(init.body)
      return jsonRes({ data: { id: 'vdc-new', name: posted.name } }, 201)
    }
    if (url.endsWith(`/api/v1/admin/vdcs/${EXISTING_VDC.id}`) && init?.method === 'PUT') {
      putBody = JSON.parse(init.body)
      return jsonRes({ data: { ...EXISTING_VDC, ...putBody } })
    }
    if (url.endsWith('/api/v1/admin/vdcs')) return jsonRes({ data: [EXISTING_VDC] })
    if (url.includes('/users')) return jsonRes({ data: [] })
    if (url.endsWith('/api/v1/tenants')) return jsonRes({ data: TENANTS })
    if (url.includes('type=pve')) return jsonRes({ data: CONNECTIONS })
    if (url.includes('type=pbs')) return jsonRes({ data: [] })
    if (url.includes('available-resources')) {
      return jsonRes({ data: { nodes: [{ name: 'pve1', status: 'online' }], storages: [{ id: 'shared-nfs', type: 'nfs', maxdisk: 1000 }] } })
    }
    if (url.includes('provider-bridges?scope=vlan-pool')) {
      return jsonRes({ data: [{ iface: 'vmbr0', nodes: ['pve1'], type: 'bridge', vlanAware: true }] })
    }
    if (url.includes('provider-bridges')) return jsonRes({ data: [] })
    if (url.includes('/connections/c1/storage-policies')) return jsonRes({ data: CONN_POLICIES })
    if (url.includes('storage-policies')) return jsonRes({ data: [] })
    return jsonRes({ data: [] })
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** Open the create dialog, pick tenant ACME, return the dialog scope. */
async function openCreateDialog() {
  renderWithProviders(<VdcTab />)

  // The Create button stays disabled until the tenants dropdown has loaded.
  const createBtn = await screen.findByRole('button', { name: 'Create vDC' })
  await waitFor(() => expect(createBtn.hasAttribute('disabled')).toBe(false))
  fireEvent.click(createBtn)

  const dialog = await screen.findByRole('dialog')
  const scope = within(dialog)

  const tenantInput = scope.getByLabelText(/^Tenant/)
  fireEvent.change(tenantInput, { target: { value: 'ACME' } })
  fireEvent.click(await screen.findByRole('option', { name: 'ACME' }))

  return scope
}

async function pickCluster(scope: ReturnType<typeof within>, name: string) {
  const clusterInput = scope.getByLabelText(/^Cluster/)
  fireEvent.change(clusterInput, { target: { value: name } })
  fireEvent.click(await screen.findByRole('option', { name }))
}

async function submitCreate(scope: ReturnType<typeof within>) {
  const submit = scope.getByRole('button', { name: 'Create' })
  // Enabled once /available-resources auto-filled nodes + primary storage.
  await waitFor(() => expect(submit.hasAttribute('disabled')).toBe(false))
  fireEvent.click(submit)
  await waitFor(() => expect(posted).toBeDefined())
}

describe('VdcTab — create dialog (multi-vDC)', () => {
  it('warns about existing vDCs and only offers free provider-pool clusters', async () => {
    const scope = await openCreateDialog()

    // The tenant already has a vDC on paris — banner lists it.
    expect(scope.getByText(/already has a vDC/i).textContent).toContain('ACME — paris (paris)')

    // Cluster picker: paris is occupied, msp-own is not in the provider pool.
    const clusterInput = scope.getByLabelText(/^Cluster/)
    fireEvent.mouseDown(clusterInput)
    fireEvent.change(clusterInput, { target: { value: '' } })
    const options = await screen.findAllByRole('option')
    const labels = options.map((o) => o.textContent)
    expect(labels).toContain('frankfurt')
    expect(labels).not.toContain('paris')
    expect(labels).not.toContain('msp-own')
  })

  it('derives the "tenant — cluster" name and slug when the Name field is left empty', async () => {
    const scope = await openCreateDialog()
    await pickCluster(scope, 'frankfurt')

    // The Name placeholder previews the derived name.
    const nameInput = scope.getByLabelText(/^Name/) as HTMLInputElement
    expect(nameInput.placeholder).toBe('ACME — frankfurt')

    await submitCreate(scope)

    expect(posted).toMatchObject({
      tenantId: 't1',
      connectionId: 'c2',
      name: 'ACME — frankfurt',
      slug: 'acme-frankfurt',
      primaryStorage: 'shared-nfs',
      nodes: ['pve1'],
    })
  })

  it('keeps a custom Name typed by the operator', async () => {
    const scope = await openCreateDialog()
    await pickCluster(scope, 'frankfurt')

    fireEvent.change(scope.getByLabelText(/^Name/), { target: { value: 'Prod Frankfurt' } })

    await submitCreate(scope)

    expect(posted.name).toBe('Prod Frankfurt')
    expect(posted.slug).toBe('acme-frankfurt')
  })

  it('adds a VLAN pool range and sends it in the create payload', async () => {
    const scope = await openCreateDialog()
    await pickCluster(scope, 'frankfurt')

    // The VLAN pools block only renders once the resources fetch resolves,
    // same gate as the Shared Bridges block right above it.
    await scope.findByText('VLAN pools')

    const addBtn = scope.getByRole('button', { name: 'Add a range' })
    await waitFor(() => expect(addBtn.hasAttribute('disabled')).toBe(false))
    fireEvent.click(addBtn)

    fireEvent.mouseDown(scope.getByLabelText('Bridge'))
    fireEvent.click(await screen.findByRole('option', { name: 'vmbr0' }))

    fireEvent.change(scope.getByLabelText('First VLAN ID'), { target: { value: '100' } })
    fireEvent.change(scope.getByLabelText('Last VLAN ID'), { target: { value: '199' } })

    await submitCreate(scope)

    expect(posted.vlanPools).toEqual([{ bridge: 'vmbr0', rangeStart: 100, rangeEnd: 199 }])
  })
})

describe('VdcTab: edit dialog storage policy assignments', () => {
  async function openEditDialog() {
    renderWithProviders(<VdcTab />)
    const nameCell = await screen.findByText(/^ACME/)

    // Scope to the DataGrid row: StoragePoliciesSection (rendered above the
    // vDC list) has its own pencil icons for editing policies, so a
    // page-wide icon-class query would grab the wrong dialog.
    const row = nameCell.closest('[role="row"]') as HTMLElement
    const editBtn = row.querySelector('.ri-pencil-line')?.closest('button') as HTMLElement
    fireEvent.click(editBtn)

    const dialog = await screen.findByRole('dialog')
    return within(dialog)
  }

  it('hydrates an existing assignment with its quota converted from MB to GB', async () => {
    const scope = await openEditDialog()

    await scope.findByText('Storage policies')
    // 51200 MB -> 50 GB
    await waitFor(() => expect(scope.getByDisplayValue('50')).toBeInTheDocument())
    expect(scope.getByText('gold')).toBeInTheDocument()
  })

  it('sends storagePolicies with quotaMb converted in the PUT payload, dropping a row left without a policy', async () => {
    const scope = await openEditDialog()
    await scope.findByText('Storage policies')
    await waitFor(() => expect(scope.getByDisplayValue('50')).toBeInTheDocument())

    // Add a second row and leave it without picking a policy: it must be
    // dropped from the payload instead of sent with an empty policyId.
    const addBtn = scope.getByRole('button', { name: 'Attach a policy' })
    await waitFor(() => expect(addBtn.hasAttribute('disabled')).toBe(false))
    fireEvent.click(addBtn)

    const saveBtn = scope.getByRole('button', { name: 'Update' })
    await waitFor(() => expect(saveBtn.hasAttribute('disabled')).toBe(false))
    fireEvent.click(saveBtn)

    await waitFor(() => expect(putBody).toBeDefined())
    expect(putBody.storagePolicies).toEqual([{ policyId: 'sp1', quotaMb: 51200 }])
  })
})
