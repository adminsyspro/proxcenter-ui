import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent, waitFor, within } from '@/__tests__/setup/renderWithProviders'

import { CephCardHeaderActions, CephServiceActionsCell, type CephDaemonTarget } from './CephServiceActions'

/*
   ui#1164: the Actions cell of the OSD / Monitor / Manager rows and the
   card header buttons. Start is immediate, stop and restart confirm, an OSD
   goes through ok-to-stop and may be forced after an acknowledgement.
*/

const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => toast }))

const fetchMock = vi.fn()
const json = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data })
const UPID = 'UPID:pve1:0001:0002:0003:srvstop:osd.2:root@pam:'

const posts = () => fetchMock.mock.calls.map(([url, init]) => [String(url), JSON.parse(String(init?.body))])

const OSD: CephDaemonTarget = { kind: 'osd', service: 'osd.2', host: 'pve1', running: true }
const MON: CephDaemonTarget = { kind: 'mon', service: 'mon.pve2', host: 'pve2', running: true }

function Cell({ target = OSD, canManage = true, onDone = vi.fn() }: Readonly<{ target?: CephDaemonTarget; canManage?: boolean; onDone?: (...args: any[]) => void }>) {
  return (
    <table>
      <tbody>
        <tr>
          <CephServiceActionsCell connId="c1" target={target} canManage={canManage} onDone={onDone} />
        </tr>
      </tbody>
    </table>
  )
}

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(json({ data: { upid: UPID } }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const button = (name: string) => screen.getByRole('button', { name })

describe('CephServiceActionsCell', () => {
  it('shows start, stop and restart; start is disabled while the daemon runs, with the reason', () => {
    renderWithProviders(<Cell />)
    expect(button('Start osd.2')).toBeDisabled()
    expect(screen.getByLabelText('osd.2 is already running')).toBeInTheDocument()
    expect(button('Stop osd.2')).toBeEnabled()
    expect(button('Restart osd.2')).toBeEnabled()
  })

  it('stop and restart are disabled while the daemon is down, and everything without the permission', () => {
    const { unmount } = renderWithProviders(<Cell target={{ ...OSD, running: false }} />)
    expect(button('Start osd.2')).toBeEnabled()
    expect(button('Stop osd.2')).toBeDisabled()
    expect(button('Restart osd.2')).toBeDisabled()
    expect(screen.getAllByLabelText('osd.2 is not running')).toHaveLength(2)
    unmount()

    renderWithProviders(<Cell target={{ ...OSD, running: false }} canManage={false} />)
    expect(button('Start osd.2')).toBeDisabled()
    expect(button('Stop osd.2')).toBeDisabled()
    expect(screen.getAllByLabelText('Managing Ceph services requires the storage.admin permission')).toHaveLength(3)
  })

  it('start posts to the host node at once, toasts the task and reports done', async () => {
    const onDone = vi.fn()
    renderWithProviders(<Cell target={{ ...OSD, running: false }} onDone={onDone} />)
    fireEvent.click(button('Start osd.2'))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Task started: starting osd.2 on pve1'))
    expect(posts()).toEqual([['/api/v1/connections/c1/nodes/pve1/ceph/service', { action: 'start', service: 'osd.2', force: false }]])
    expect(onDone).toHaveBeenCalledWith('start', UPID)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a failed start is a toast, not a dialog', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'PVE 500: no such service' }, 500))
    renderWithProviders(<Cell target={{ ...OSD, running: false }} />)
    fireEvent.click(button('Start osd.2'))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Ceph service action failed: PVE 500: no such service'))
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('stop of an OSD confirms, is refused by ok-to-stop with the PG count, then forced after the acknowledgement', async () => {
    const onDone = vi.fn()
    fetchMock.mockResolvedValueOnce(json({ error: 'Stopping osd.2 would take 33 PG(s) offline', code: 'not_ok_to_stop', okToStop: { ok: false, osds: [2], numOkPgs: 0, numNotOkPgs: 33, message: null } }, 409))
    renderWithProviders(<Cell onDone={onDone} />)
    fireEvent.click(button('Stop osd.2'))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Stop osd.2')
    expect(dialog).toHaveTextContent('osd.2 will be stopped on pve1.')
    expect(dialog).toHaveTextContent('ceph osd ok-to-stop is asked first')
    expect(screen.queryByTestId('ceph-not-ok-to-stop')).toBeNull()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Stop' }))
    const refusal = await screen.findByTestId('ceph-not-ok-to-stop')
    expect(refusal).toHaveTextContent('Stopping osd.2 is not safe right now')
    expect(refusal).toHaveTextContent('33 placement groups would go offline while the OSD is down')
    expect(posts()).toEqual([['/api/v1/connections/c1/nodes/pve1/ceph/service', { action: 'stop', service: 'osd.2', force: false }]])
    expect(within(dialog).getByRole('button', { name: 'Stop' })).toBeDisabled()
    expect(onDone).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'I understand, proceed anyway' }))
    expect(within(dialog).getByRole('button', { name: 'Stop' })).toBeEnabled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stop' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Task started: stopping osd.2 on pve1'))
    expect(posts()[1]).toEqual(['/api/v1/connections/c1/nodes/pve1/ceph/service', { action: 'stop', service: 'osd.2', force: true }])
    expect(onDone).toHaveBeenCalledWith('stop', UPID)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('a verdict that could not be obtained is shown with its reason', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'ssh timeout', code: 'not_ok_to_stop', okToStop: { ok: false, osds: [2], numOkPgs: 0, numNotOkPgs: 0, message: 'ssh timeout' } }, 409))
    renderWithProviders(<Cell />)
    fireEvent.click(button('Restart osd.2'))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Restart osd.2')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Restart' }))
    expect(await screen.findByTestId('ceph-not-ok-to-stop')).toHaveTextContent('ceph osd ok-to-stop could not be evaluated: ssh timeout')
  })

  it('stopping a monitor warns about the quorum, confirms once and closes', async () => {
    renderWithProviders(<Cell target={MON} />)
    fireEvent.click(button('Stop mon.pve2'))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Stopping a monitor can cost the cluster its quorum')
    expect(dialog).not.toHaveTextContent('ok-to-stop')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Task started: stopping mon.pve2 on pve2'))
    expect(posts()).toEqual([['/api/v1/connections/c1/nodes/pve2/ceph/service', { action: 'stop', service: 'mon.pve2', force: false }]])
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('a failed restart stays in the dialog with the server message; cancel closes it', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'PVE 500: unit not found' }, 500))
    renderWithProviders(<Cell target={MON} />)
    fireEvent.click(button('Restart mon.pve2'))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Restart' }))
    await waitFor(() => expect(dialog).toHaveTextContent('Ceph service action failed: PVE 500: unit not found'))
    expect(toast.error).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

describe('CephCardHeaderActions', () => {
  it('refresh calls back, create opens, and a disabled create carries its reason', () => {
    const onRefresh = vi.fn()
    const onCreate = vi.fn()
    const { rerender } = renderWithProviders(
      <CephCardHeaderActions onRefresh={onRefresh} onCreate={onCreate} createLabel="Create monitor" canManage />,
    )
    fireEvent.click(button('Refresh the Ceph data of this node'))
    expect(onRefresh).toHaveBeenCalledTimes(1)
    fireEvent.click(button('Create monitor'))
    expect(onCreate).toHaveBeenCalledTimes(1)

    rerender(
      <CephCardHeaderActions onRefresh={onRefresh} onCreate={onCreate} createLabel="Create monitor" createDisabledReason="This node already runs a monitor" canManage refreshing />,
    )
    expect(button('Create monitor')).toBeDisabled()
    expect(screen.getByLabelText('This node already runs a monitor')).toBeInTheDocument()
    expect(button('Refresh the Ceph data of this node')).toBeDisabled()
  })

  it('without the permission, create is disabled and says why; refresh stays available', () => {
    renderWithProviders(<CephCardHeaderActions onRefresh={vi.fn()} onCreate={vi.fn()} createLabel="Create OSD" canManage={false} />)
    expect(button('Create OSD')).toBeDisabled()
    expect(screen.getByLabelText('Managing Ceph services requires the storage.admin permission')).toBeInTheDocument()
    expect(button('Refresh the Ceph data of this node')).toBeEnabled()
  })
})
