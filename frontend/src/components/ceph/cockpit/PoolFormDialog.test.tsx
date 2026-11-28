import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { fireEvent, renderWithProviders, screen, waitFor, within } from '@/__tests__/setup/renderWithProviders'

/*
   ui#1450: the dialog that creates or edits a pool. It only says "created"
   once the PVE task ended well: a create call answered 200 can still fail in
   the task (too many PGs per OSD, measured on the lab).
*/

const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => toast }))
const waitMock = vi.fn()
vi.mock('@/lib/proxmox/waitForTaskClient', () => ({ waitForPveTask: (...a: unknown[]) => waitMock(...a) }))

import PoolFormDialog from './PoolFormDialog'

const fetchMock = vi.fn()
const json = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data })
const UPID = 'UPID:pve1:1:2:3:cephcreatepool:vm-pool:root@pam!pxc:'
const RULES = [{ id: 0, name: 'replicated_rule', steps: [] }, { id: 1, name: 'replicated_ssd', steps: [] }]
const POOL = { name: 'vm-pool', size: 3, minSize: 2, crushRule: 1, crushRuleName: 'replicated_ssd', pgAutoscaleMode: 'warn' } as any

const sent = () => fetchMock.mock.calls.map(([url, init]) => [String(url), init?.method, init?.body ? JSON.parse(String(init.body)) : undefined])

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(json({ data: { upid: UPID, node: 'pve1' } }))
  vi.stubGlobal('fetch', fetchMock)
  waitMock.mockReset()
  waitMock.mockResolvedValue({ outcome: 'ok' })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

function create(onDone = vi.fn(), onClose = vi.fn()) {
  renderWithProviders(<PoolFormDialog open mode='create' connId='c1' crushRules={RULES} onClose={onClose} onDone={onDone} />)
  return within(screen.getByRole('dialog'))
}

describe('PoolFormDialog, creation', () => {
  it('sends the defaults, follows the task, then toasts and closes', async () => {
    const onDone = vi.fn()
    const onClose = vi.fn()
    const d = create(onDone, onClose)
    fireEvent.change(d.getByLabelText('Name'), { target: { value: 'vm-pool' } })
    fireEvent.click(d.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(sent()).toEqual([['/api/v1/connections/c1/ceph/pools', 'POST', {
      name: 'vm-pool', size: 3, minSize: 2, allowSingleCopy: false, autoscale: 'on', application: 'rbd', addStorage: true,
    }]])
    expect(waitMock).toHaveBeenCalledWith('c1', 'pve1', UPID, expect.anything())
    expect(toast.success).toHaveBeenCalledWith('Pool vm-pool created')
    expect(onClose).toHaveBeenCalled()
  })

  it('keeps the dialog open with the reason when the task fails', async () => {
    waitMock.mockResolvedValue({ outcome: 'failed', reason: 'pg_num 32 size 3 would result in 257 cumulative PGs per OSD' })
    const onClose = vi.fn()
    const d = create(vi.fn(), onClose)
    fireEvent.change(d.getByLabelText('Name'), { target: { value: 'vm-pool' } })
    fireEvent.click(d.getByRole('button', { name: 'Create' }))

    expect(await d.findByText(/257 cumulative PGs per OSD/)).toBeInTheDocument()
    expect(toast.success).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('sends one request on a double click', async () => {
    let release: (v: unknown) => void = () => {}
    fetchMock.mockReturnValue(new Promise(r => { release = r }))
    const d = create()
    fireEvent.change(d.getByLabelText('Name'), { target: { value: 'vm-pool' } })
    const button = d.getByRole('button', { name: 'Create' })
    fireEvent.click(button)
    fireEvent.click(button)
    release(json({ data: { upid: UPID, node: 'pve1' } }))
    await waitFor(() => expect(waitMock).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('asks for an explicit choice before min. size 1', () => {
    const d = create()
    fireEvent.change(d.getByLabelText('Name'), { target: { value: 'vm-pool' } })
    fireEvent.change(d.getByLabelText('Min. size'), { target: { value: '1' } })
    expect(d.getByRole('button', { name: 'Create' })).toBeDisabled()
    fireEvent.click(d.getByLabelText('Accept writes on a single copy'))
    expect(d.getByRole('button', { name: 'Create' })).toBeEnabled()
  })

  it('refuses a name PVE would refuse, and a min. size above the size', () => {
    const d = create()
    fireEvent.change(d.getByLabelText('Name'), { target: { value: 'bad name' } })
    expect(d.getByRole('button', { name: 'Create' })).toBeDisabled()
    fireEvent.change(d.getByLabelText('Name'), { target: { value: 'ok' } })
    fireEvent.change(d.getByLabelText('Size'), { target: { value: '2' } })
    fireEvent.change(d.getByLabelText('Min. size'), { target: { value: '3' } })
    expect(d.getByRole('button', { name: 'Create' })).toBeDisabled()
  })

  it('shows the route refusal', async () => {
    fetchMock.mockResolvedValue(json({ error: 'No node of the cluster is online' }, 503))
    const d = create()
    fireEvent.change(d.getByLabelText('Name'), { target: { value: 'vm-pool' } })
    fireEvent.click(d.getByRole('button', { name: 'Create' }))
    expect(await d.findByText(/No node of the cluster is online/)).toBeInTheDocument()
    expect(waitMock).not.toHaveBeenCalled()
  })
})

describe('PoolFormDialog, edit', () => {
  it('starts from the pool and sends the editable fields only', async () => {
    const onDone = vi.fn()
    renderWithProviders(<PoolFormDialog open mode='edit' connId='c1' pool={POOL} crushRules={RULES} onClose={vi.fn()} onDone={onDone} />)
    const d = within(screen.getByRole('dialog'))
    expect(screen.getByRole('dialog')).toHaveTextContent('Edit pool vm-pool')
    expect(d.queryByLabelText('Name')).toBeNull()
    fireEvent.change(d.getByLabelText('Size'), { target: { value: '4' } })
    fireEvent.click(d.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(sent()).toEqual([['/api/v1/connections/c1/ceph/pools/vm-pool', 'PUT', {
      size: 4, minSize: 2, allowSingleCopy: false, autoscale: 'warn', crushRule: 'replicated_ssd',
    }]])
    expect(toast.success).toHaveBeenCalledWith('Pool vm-pool updated')
  })
})
