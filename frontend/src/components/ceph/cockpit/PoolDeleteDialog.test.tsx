import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { fireEvent, renderWithProviders, screen, waitFor, within } from '@/__tests__/setup/renderWithProviders'

/*
   ui#1450: deletion of a pool. A pool holding data asks for its name; the
   server refuses a pool whose storages still hold guest disks, and the dialog
   lists them.
*/

const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => toast }))
const waitMock = vi.fn()
vi.mock('@/lib/proxmox/waitForTaskClient', () => ({ waitForPveTask: (...a: unknown[]) => waitMock(...a) }))

import PoolDeleteDialog from './PoolDeleteDialog'

const fetchMock = vi.fn()
const json = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data })
const POOL = { name: 'vm-pool', bytesUsed: 1024 ** 3, objects: 250, bytesUsedFormatted: '1.0 GiB' } as any
const EMPTY = { name: 'scratch', bytesUsed: 0, objects: 0, bytesUsedFormatted: '0 B' } as any

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(json({ data: { upid: 'UPID:pve1:1:2:3:cephdestroypool:vm-pool:root@pam!pxc:', node: 'pve1' } }))
  vi.stubGlobal('fetch', fetchMock)
  waitMock.mockReset()
  waitMock.mockResolvedValue({ outcome: 'ok' })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

function open(pool = POOL, storages = ['vm-pool'], onDone = vi.fn()) {
  renderWithProviders(<PoolDeleteDialog open connId='c1' pool={pool} storages={storages} onClose={vi.fn()} onDone={onDone} />)
  return within(screen.getByRole('dialog'))
}

describe('PoolDeleteDialog', () => {
  it('asks for the name of a pool holding data, then deletes it with its storages', async () => {
    const onDone = vi.fn()
    const d = open(POOL, ['vm-pool'], onDone)
    expect(screen.getByRole('dialog')).toHaveTextContent('Other clusters that use this pool as an external RBD storage are not checked.')
    const button = d.getByRole('button', { name: 'Delete' })
    expect(button).toBeDisabled()
    fireEvent.change(d.getByLabelText('Type vm-pool to confirm'), { target: { value: 'vm-poo' } })
    expect(button).toBeDisabled()
    fireEvent.change(d.getByLabelText('Type vm-pool to confirm'), { target: { value: 'vm-pool' } })
    fireEvent.click(button)

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0]).toEqual(['/api/v1/connections/c1/ceph/pools/vm-pool?removeStorages=1', { method: 'DELETE' }])
    expect(toast.success).toHaveBeenCalledWith('Pool vm-pool deleted')
  })

  it('keeps the PVE storages when the box is cleared', async () => {
    const d = open(POOL)
    fireEvent.click(d.getByLabelText('Also remove the PVE storages of this pool'))
    fireEvent.change(d.getByLabelText('Type vm-pool to confirm'), { target: { value: 'vm-pool' } })
    fireEvent.click(d.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/connections/c1/ceph/pools/vm-pool')
  })

  it('needs no typed name for an empty pool', () => {
    const d = open(EMPTY, [])
    expect(d.queryByLabelText('Type scratch to confirm')).toBeNull()
    expect(d.getByRole('button', { name: 'Delete' })).toBeEnabled()
  })

  it('lists the guest disks the server found on the pool', async () => {
    fetchMock.mockResolvedValue(json({ error: 'The pool still holds guest disks', code: 'POOL_HAS_GUEST_DISKS', disks: ['vm-pool:vm-100-disk-0'] }, 409))
    const d = open(POOL)
    fireEvent.change(d.getByLabelText('Type vm-pool to confirm'), { target: { value: 'vm-pool' } })
    fireEvent.click(d.getByRole('button', { name: 'Delete' }))
    expect(await d.findByText('vm-pool:vm-100-disk-0')).toBeInTheDocument()
    expect(d.getByText(/still on the pool/)).toBeInTheDocument()
    expect(waitMock).not.toHaveBeenCalled()
  })
})
