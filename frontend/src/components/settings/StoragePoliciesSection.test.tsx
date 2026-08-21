/**
 * Component tests for StoragePoliciesSection.tsx (Task 15, P3 storage
 * policies + QoS): the provider-only CRUD surface for named QoS profiles
 * on a shared storage, rendered as one Card per connection above the vDC
 * list in VdcTab.
 *
 * Covers: the table lists mocked policies per connection, creating a
 * policy POSTs the right body, and delete is disabled with a tooltip when
 * a policy is still assigned to a vDC (vdcCount > 0).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'
import StoragePoliciesSection from '@/components/settings/StoragePoliciesSection'

const CONNECTIONS = [
  { id: 'c1', name: 'paris' },
  { id: 'c2', name: 'frankfurt' },
]

const POLICIES_C1 = [
  {
    id: 'p1',
    connectionId: 'c1',
    name: 'gold',
    description: null,
    storageId: 'ceph-fast',
    iopsRd: 5000,
    iopsWr: 3000,
    mbpsRd: 500,
    mbpsWr: 300,
    vdcCount: 2,
  },
  {
    id: 'p2',
    connectionId: 'c1',
    name: 'bronze',
    description: null,
    storageId: 'nfs-slow',
    iopsRd: null,
    iopsWr: null,
    mbpsRd: null,
    mbpsWr: null,
    vdcCount: 0,
  },
]

let posted: any
let deletedUrl: string | undefined
let putBody: any
let applyRequested: boolean

function jsonRes(body: any, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response
}

/** Fake streaming Response whose body.getReader() delivers the given NDJSON
 *  events as one chunk, then signals done: matches the shape the component
 *  reads (res.body.getReader() + TextDecoder + split('\n')) without pulling
 *  in a real ReadableStream. */
function fakeNdjsonResponse(events: any[]): Response {
  const text = events.map((e) => `${JSON.stringify(e)}\n`).join('')
  const bytes = new TextEncoder().encode(text)
  let sent = false
  const reader = {
    read: async () => {
      if (sent) return { done: true, value: undefined }
      sent = true
      return { done: false, value: bytes }
    },
  }
  return { ok: true, body: { getReader: () => reader } } as unknown as Response
}

const APPLY_EVENTS = [
  { type: 'start', total: 2 },
  { type: 'vm', index: 0, total: 2, vmid: 201, name: 'web-01', node: 'pve1', disks: ['scsi0'], status: 'updated' },
  { type: 'vm', index: 1, total: 2, vmid: 202, name: 'web-02', node: 'pve1', disks: [], status: 'unchanged' },
  { type: 'done', updated: 1, unchanged: 1, errors: 0 },
]

const DISKS_P1 = {
  vms: [
    {
      vmid: 301, name: 'db-01', node: 'pve1', vmstatus: 'running',
      disks: [
        { key: 'scsi0', iopsRd: 5000, iopsWr: 3000, mbpsRd: 500, mbpsWr: 300, inSync: true },
        { key: 'scsi1', iopsRd: 1000, iopsWr: 1000, mbpsRd: 100, mbpsWr: 100, inSync: false },
      ],
    },
  ],
}

beforeEach(() => {
  posted = undefined
  deletedUrl = undefined
  putBody = undefined
  applyRequested = false
  vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
    const url = String(input)

    if (url.endsWith('/connections/c1/storage-policies/p1/apply') && init?.method === 'POST') {
      applyRequested = true
      return fakeNdjsonResponse(APPLY_EVENTS)
    }
    if (url.endsWith('/connections/c1/storage-policies/p1/disks')) return jsonRes({ data: DISKS_P1 })
    if (url.endsWith('/connections/c1/storage-policies/p2/disks')) return jsonRes({ data: { vms: [] } })
    const putMatch = url.match(/\/connections\/c1\/storage-policies\/(p\d+)$/)
    if (putMatch && init?.method === 'PUT') {
      putBody = JSON.parse(init.body)
      const base = putMatch[1] === 'p1' ? POLICIES_C1[0] : POLICIES_C1[1]
      return jsonRes({ data: { ...base, ...putBody } })
    }
    if (url.includes('/connections/c1/storage-policies') && init?.method === 'POST') {
      posted = JSON.parse(init.body)
      return jsonRes({ data: { id: 'p-new', ...posted } }, 201)
    }
    if (url.includes('/connections/c1/storage-policies/p2') && init?.method === 'DELETE') {
      deletedUrl = url
      return jsonRes({ success: true })
    }
    if (url.endsWith('/connections/c1/storage-policies')) return jsonRes({ data: POLICIES_C1 })
    if (url.endsWith('/connections/c2/storage-policies')) return jsonRes({ data: [] })
    if (url.includes('/connections/c1/available-resources')) {
      // ceph-free carries no policy: it is the only selectable option in the
      // create dialog, the other two are already governed (gold / bronze).
      return jsonRes({ data: { storages: [
        { id: 'ceph-fast', type: 'rbd' }, { id: 'nfs-slow', type: 'nfs' }, { id: 'ceph-free', type: 'rbd' },
      ] } })
    }
    if (url.includes('/connections/c2/available-resources')) {
      return jsonRes({ data: { storages: [] } })
    }
    return jsonRes({ data: [] })
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('StoragePoliciesSection', () => {
  it('lists the mocked policies for each connection', async () => {
    renderWithProviders(<StoragePoliciesSection connections={CONNECTIONS} />)

    expect(await screen.findByText('gold')).toBeInTheDocument()
    expect(screen.getByText('bronze')).toBeInTheDocument()
    expect(screen.getByText('ceph-fast')).toBeInTheDocument()
    expect(screen.getByText('5000')).toBeInTheDocument()
  })

  it('creates a policy with the expected POST body', async () => {
    renderWithProviders(<StoragePoliciesSection connections={CONNECTIONS} />)
    await screen.findByText('gold')

    const addButtons = screen.getAllByRole('button', { name: 'Add a storage policy' })
    fireEvent.click(addButtons[0])

    const dialog = await screen.findByRole('dialog')
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'silver' } })

    fireEvent.mouseDown(screen.getByLabelText(/^Storage/))
    fireEvent.click(await screen.findByRole('option', { name: /ceph-free/ }))

    fireEvent.change(screen.getByLabelText(/IOPS \(read\)/), { target: { value: '1000' } })

    const saveBtn = await screen.findByRole('button', { name: 'Save' })
    await waitFor(() => expect(saveBtn.hasAttribute('disabled')).toBe(false))
    fireEvent.click(saveBtn)

    await waitFor(() => expect(posted).toBeDefined())
    expect(posted).toMatchObject({
      name: 'silver',
      storageId: 'ceph-free',
      iopsRd: 1000,
      iopsWr: null,
      mbpsRd: null,
      mbpsWr: null,
    })

    await waitFor(() => expect(dialog).not.toBeInTheDocument())
  })

  it('disables the storages already governed by another policy in the create dialog', async () => {
    renderWithProviders(<StoragePoliciesSection connections={CONNECTIONS} />)
    await screen.findByText('gold')

    fireEvent.click(screen.getAllByRole('button', { name: 'Add a storage policy' })[0])
    await screen.findByRole('dialog')
    fireEvent.mouseDown(screen.getByLabelText(/^Storage/))

    // One policy per (connection, storage): the two storages already carrying
    // one are offered but not selectable, and each names its owner.
    const taken = await screen.findByRole('option', { name: /ceph-fast/ })

    expect(taken).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByText('Already governed by "gold"')).toBeInTheDocument()
    expect(screen.getByText('Already governed by "bronze"')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /ceph-free/ })).not.toHaveAttribute('aria-disabled')
  })

  it('disables delete with a tooltip when the policy is still assigned to a vDC', async () => {
    renderWithProviders(<StoragePoliciesSection connections={CONNECTIONS} />)
    await screen.findByText('gold')

    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' })
    // gold (vdcCount: 2) is the first row, bronze (vdcCount: 0) the second.
    expect(deleteButtons[0].hasAttribute('disabled')).toBe(true)
    expect(deleteButtons[1].hasAttribute('disabled')).toBe(false)

    fireEvent.click(deleteButtons[1])
    await waitFor(() => expect(deletedUrl).toContain('/connections/c1/storage-policies/p2'))
  })

  it('disables the storage select in the edit dialog when the policy has vDC assignments (Finding I3)', async () => {
    renderWithProviders(<StoragePoliciesSection connections={CONNECTIONS} />)
    await screen.findByText('gold')

    const editButtons = screen.getAllByRole('button', { name: 'Edit' })
    // gold (vdcCount: 2) is the first row, bronze (vdcCount: 0) the second.
    fireEvent.click(editButtons[0])

    await screen.findByRole('dialog')
    const storageSelect = screen.getByLabelText(/^Storage/)
    expect(storageSelect.getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByText(/In use by 2 vDCs/)).toBeInTheDocument()
  })

  it('leaves the storage select enabled in the edit dialog when the policy has no vDC assignments', async () => {
    renderWithProviders(<StoragePoliciesSection connections={CONNECTIONS} />)
    await screen.findByText('bronze')

    const editButtons = screen.getAllByRole('button', { name: 'Edit' })
    fireEvent.click(editButtons[1])

    await screen.findByRole('dialog')
    const storageSelect = screen.getByLabelText(/^Storage/)
    expect(storageSelect.getAttribute('aria-disabled')).toBeNull()
  })
})

describe('bulk apply progress phase (Task 16)', () => {
  it('switches to the apply-progress phase after saving an edit that changes a QoS cap, and streams progress to done', async () => {
    renderWithProviders(<StoragePoliciesSection connections={CONNECTIONS} />)
    await screen.findByText('gold')

    const editButtons = screen.getAllByRole('button', { name: 'Edit' })
    fireEvent.click(editButtons[0]) // gold = p1

    await screen.findByRole('dialog')
    fireEvent.change(screen.getByLabelText(/IOPS \(read\)/), { target: { value: '6000' } })

    const saveBtn = await screen.findByRole('button', { name: 'Save' })
    fireEvent.click(saveBtn)

    await waitFor(() => expect(putBody).toMatchObject({ iopsRd: 6000 }))
    await waitFor(() => expect(applyRequested).toBe(true))

    expect(await screen.findByText('Applying storage policy to existing disks')).toBeInTheDocument()
    await screen.findByText(/web-01 \(201\)/)
    expect(screen.getByText(/web-02 \(202\)/)).toBeInTheDocument()

    expect(await screen.findByText('1 disk(s) updated, 1 unchanged, 0 error(s)')).toBeInTheDocument()

    const closeBtn = screen.getByRole('button', { name: 'Close' })
    expect(closeBtn.hasAttribute('disabled')).toBe(false)
    fireEvent.click(closeBtn)

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('closes immediately without calling apply when the edit does not change any QoS cap', async () => {
    renderWithProviders(<StoragePoliciesSection connections={CONNECTIONS} />)
    await screen.findByText('bronze')

    const editButtons = screen.getAllByRole('button', { name: 'Edit' })
    fireEvent.click(editButtons[1]) // bronze = p2, no caps set

    const dialog = await screen.findByRole('dialog')
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'bronze-renamed' } })

    const saveBtn = await screen.findByRole('button', { name: 'Save' })
    fireEvent.click(saveBtn)

    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    expect(applyRequested).toBe(false)
  })
})

describe('expandable policy disks (drift detection)', () => {
  it('expands a policy row, fetches its governed disks, and colors the drifted one as a warning', async () => {
    renderWithProviders(<StoragePoliciesSection connections={CONNECTIONS} />)
    await screen.findByText('gold')

    fireEvent.click(screen.getByRole('button', { name: 'Expand gold' }))

    await screen.findByText(/db-01 \(301\)/)
    expect(screen.getByText('pve1')).toBeInTheDocument()

    const inSyncChip = screen.getByText('scsi0 · 5000/3000 · 500/300M').closest('.MuiChip-root')
    expect(inSyncChip).not.toHaveClass('MuiChip-colorWarning')

    const driftedChip = screen.getByText('scsi1 · 1000/1000 · 100/100M').closest('.MuiChip-root')
    expect(driftedChip).toHaveClass('MuiChip-colorWarning')
  })

  it('renders the no-disks caption when a policy governs no existing disks', async () => {
    renderWithProviders(<StoragePoliciesSection connections={CONNECTIONS} />)
    await screen.findByText('bronze')

    fireEvent.click(screen.getByRole('button', { name: 'Expand bronze' }))

    expect(await screen.findByText('No existing disks are governed by this policy yet')).toBeInTheDocument()
  })
})
