import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent, waitFor, within } from '@/__tests__/setup/renderWithProviders'

import CephCreateDaemonDialog from './CephCreateDaemonDialog'

/*
   ui#1164: the monitor and manager creation dialogs, one POST each.
*/

const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => toast }))

const fetchMock = vi.fn()
const json = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data })
const posts = () => fetchMock.mock.calls.map(([url, init]) => [String(url), init?.method, JSON.parse(String(init?.body))])

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(json({ data: { upid: 'UPID:pve1:1:2:3:cephcreatemon:pve1:root@pam:' } }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('CephCreateDaemonDialog', () => {
  it('creates a monitor with its optional address, toasts and closes', async () => {
    const onClose = vi.fn()
    const onCreated = vi.fn()
    renderWithProviders(<CephCreateDaemonDialog open kind="mon" connId="c1" node="pve1" onClose={onClose} onCreated={onCreated} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Create monitor on pve1')
    expect(dialog).toHaveTextContent('A monitor keeps the cluster map.')
    fireEvent.change(within(dialog).getByLabelText('Monitor address'), { target: { value: ' 10.42.0.101 ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Task started: creating a monitor on pve1'))
    expect(posts()).toEqual([['/api/v1/connections/c1/nodes/pve1/ceph/create', 'POST', { kind: 'mon', 'mon-address': '10.42.0.101' }]])
    expect(onCreated).toHaveBeenCalledWith('UPID:pve1:1:2:3:cephcreatemon:pve1:root@pam:')
    expect(onClose).toHaveBeenCalled()
  })

  it('creates a manager without any field', async () => {
    const onClose = vi.fn()
    renderWithProviders(<CephCreateDaemonDialog open kind="mgr" connId="c1" node="pve2" onClose={onClose} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Create manager on pve2')
    expect(within(dialog).queryByLabelText('Monitor address')).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Task started: creating a manager on pve2'))
    expect(posts()).toEqual([['/api/v1/connections/c1/nodes/pve2/ceph/create', 'POST', { kind: 'mgr' }]])
    expect(onClose).toHaveBeenCalled()
  })

  it('keeps the dialog open with the server message on failure; cancel closes', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'Monitor address must be one or more IP addresses, comma separated' }, 400))
    const onClose = vi.fn()
    renderWithProviders(<CephCreateDaemonDialog open kind="mon" connId="c1" node="pve1" onClose={onClose} />)
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Monitor address'), { target: { value: 'pve1' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(dialog).toHaveTextContent('Creation failed: Monitor address must be one or more IP addresses, comma separated'))
    expect(onClose).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
