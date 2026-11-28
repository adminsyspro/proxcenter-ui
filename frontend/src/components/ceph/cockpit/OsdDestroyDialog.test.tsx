import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { fireEvent, renderWithProviders, screen, waitFor, within } from '@/__tests__/setup/renderWithProviders'

/*
   ui#1450: destruction of an OSD, already out and stopped. The name is typed
   to confirm; the disk is wiped by default; Ceph's refusal is shown.
*/

const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => toast }))
const waitMock = vi.fn()
vi.mock('@/lib/proxmox/waitForTaskClient', () => ({ waitForPveTask: (...a: unknown[]) => waitMock(...a) }))

import OsdDestroyDialog from './OsdDestroyDialog'

const fetchMock = vi.fn()
const json = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data })
const OSD = { id: 3, name: 'osd.3', host: 'pve2', up: false, in: false } as any

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(json({ data: { upid: 'UPID:pve2:1:2:3:cephdestroyosd:osd.3:root@pam:', node: 'pve2' } }))
  vi.stubGlobal('fetch', fetchMock)
  waitMock.mockReset()
  waitMock.mockResolvedValue({ outcome: 'ok' })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

function open(onDone = vi.fn()) {
  renderWithProviders(<OsdDestroyDialog open connId='c1' node='pve2' osd={OSD} onClose={vi.fn()} onDone={onDone} />)
  return within(screen.getByRole('dialog'))
}

describe('OsdDestroyDialog', () => {
  it('asks for the OSD name, then destroys it and wipes its disk', async () => {
    const onDone = vi.fn()
    const d = open(onDone)
    const button = d.getByRole('button', { name: 'Destroy' })
    expect(button).toBeDisabled()
    fireEvent.change(d.getByLabelText('Type osd.3 to confirm'), { target: { value: 'osd.3' } })
    fireEvent.click(button)

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0]).toEqual(['/api/v1/connections/c1/nodes/pve2/ceph/osd/3?cleanup=1', { method: 'DELETE' }])
    expect(toast.success).toHaveBeenCalledWith('osd.3 destroyed')
  })

  it('keeps the disk when the box is cleared', async () => {
    const d = open()
    fireEvent.click(d.getByLabelText('Wipe the disk (cleanup)'))
    fireEvent.change(d.getByLabelText('Type osd.3 to confirm'), { target: { value: 'osd.3' } })
    fireEvent.click(d.getByRole('button', { name: 'Destroy' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/connections/c1/nodes/pve2/ceph/osd/3')
  })

  it("shows Ceph's refusal with the number of PGs", async () => {
    fetchMock.mockResolvedValue(json({ error: 'Destroying osd.3 is not safe yet', code: 'OSD_NOT_SAFE', numNotOkPgs: 4 }, 409))
    const d = open()
    fireEvent.change(d.getByLabelText('Type osd.3 to confirm'), { target: { value: 'osd.3' } })
    fireEvent.click(d.getByRole('button', { name: 'Destroy' }))
    expect(await d.findByText(/4 placement groups/)).toBeInTheDocument()
    expect(waitMock).not.toHaveBeenCalled()
  })
})
