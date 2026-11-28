import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { fireEvent, renderWithProviders, screen, waitFor, within } from '@/__tests__/setup/renderWithProviders'

/*
   ui#1450: creation of an OSD. The dialog reads the free disks of the chosen
   node and whether the SSH account may run pveceph there; without the sudo
   rule it says where to grant it and creates nothing.
*/

const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => toast }))
const waitMock = vi.fn()
vi.mock('@/lib/proxmox/waitForTaskClient', () => ({ waitForPveTask: (...a: unknown[]) => waitMock(...a) }))

import OsdCreateDialog from './OsdCreateDialog'

const fetchMock = vi.fn()
const json = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data })
const DISK = { devpath: '/dev/sdg', sizeBytes: 10737418240, model: 'QEMU_HARDDISK', serial: 's6', type: 'hdd', wearout: 'N/A' }
const UPID = 'UPID:pve1:1:2:3:cephcreateosd:sdg:root@pam:'

function route(disks: unknown[], ssh = 'ok', create: unknown = json({ data: { upid: UPID, node: 'pve1' } })) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/ceph/disks')) return json({ data: { disks, ssh } })
    if (init?.method === 'POST') return create
    throw new Error(`unexpected ${url}`)
  })
}

beforeEach(() => {
  fetchMock.mockReset()
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
  renderWithProviders(<OsdCreateDialog open connId='c1' nodes={['pve1', 'pve2']} onClose={vi.fn()} onDone={onDone} />)
  return within(screen.getByRole('dialog'))
}

describe('OsdCreateDialog', () => {
  it('creates an OSD on the free disk of the first node and follows the task', async () => {
    route([DISK])
    const onDone = vi.fn()
    const d = open(onDone)
    await d.findByText(/\/dev\/sdg/)
    fireEvent.click(d.getByRole('button', { name: 'Create OSD' }))

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(post[0]).toBe('/api/v1/connections/c1/nodes/pve1/ceph/osd')
    expect(JSON.parse(String(post[1].body))).toEqual({ dev: '/dev/sdg', encrypted: false })
    expect(waitMock).toHaveBeenCalledWith('c1', 'pve1', UPID, expect.anything())
    expect(toast.success).toHaveBeenCalledWith('OSD created on pve1 (/dev/sdg)')
  })

  it('says so when the node has no free disk', async () => {
    route([])
    const d = open()
    expect(await d.findByText('No free disk on this node.')).toBeInTheDocument()
    expect(d.getByRole('button', { name: 'Create OSD' })).toBeDisabled()
  })

  it('points to the SSH commands settings when the sudo rule is missing', async () => {
    route([DISK], 'missing-rule')
    const d = open()
    const link = await d.findByRole('link', { name: 'Settings > SSH commands' })
    expect(link).toHaveAttribute('href', '/settings?tab=ssh-commands')
    expect(d.getByRole('button', { name: 'Create OSD' })).toBeDisabled()
  })

  it('shows what pveceph printed when it failed', async () => {
    route([DISK], 'ok', json({ error: 'pveceph failed', code: 'PVECEPH_FAILED', output: "device '/dev/sdg' is already in use" }, 422))
    const d = open()
    await d.findByText(/\/dev\/sdg/)
    fireEvent.click(d.getByRole('button', { name: 'Create OSD' }))
    expect(await d.findByText(/is already in use/)).toBeInTheDocument()
    expect(waitMock).not.toHaveBeenCalled()
  })

  it('labels the DB and WAL selects of the advanced options', async () => {
    route([DISK, { ...DISK, devpath: '/dev/sdh' }])
    const d = open()
    await d.findAllByText(/\/dev\/sdg/)
    fireEvent.click(d.getByRole('button', { name: 'Advanced options' }))
    expect(d.getByRole('combobox', { name: 'DB device' })).toBeInTheDocument()
    expect(d.getByRole('combobox', { name: 'WAL device' })).toBeInTheDocument()
  })

  it('reads the disks of the node picked', async () => {
    route([DISK])
    const d = open()
    await d.findByText(/\/dev\/sdg/)
    fireEvent.mouseDown(d.getAllByRole('combobox')[0])
    fireEvent.click(await screen.findByRole('option', { name: 'pve2' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => u === '/api/v1/connections/c1/nodes/pve2/ceph/disks')).toBe(true))
  })
})
