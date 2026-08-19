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

function jsonRes(body: any, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response
}

beforeEach(() => {
  posted = undefined
  deletedUrl = undefined
  vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
    const url = String(input)

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
      return jsonRes({ data: { storages: [{ id: 'ceph-fast', type: 'rbd' }, { id: 'nfs-slow', type: 'nfs' }] } })
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
    fireEvent.click(await screen.findByRole('option', { name: /nfs-slow/ }))

    fireEvent.change(screen.getByLabelText(/IOPS \(read\)/), { target: { value: '1000' } })

    const saveBtn = await screen.findByRole('button', { name: 'Save' })
    await waitFor(() => expect(saveBtn.hasAttribute('disabled')).toBe(false))
    fireEvent.click(saveBtn)

    await waitFor(() => expect(posted).toBeDefined())
    expect(posted).toMatchObject({
      name: 'silver',
      storageId: 'nfs-slow',
      iopsRd: 1000,
      iopsWr: null,
      mbpsRd: null,
      mbpsWr: null,
    })

    await waitFor(() => expect(dialog).not.toBeInTheDocument())
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
