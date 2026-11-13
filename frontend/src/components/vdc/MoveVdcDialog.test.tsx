import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderWithProviders, screen, fireEvent, waitFor, within } from '@/__tests__/setup/renderWithProviders'

const h = vi.hoisted(() => ({ addTask: vi.fn(), updateTask: vi.fn(), track: vi.fn() }))
vi.mock('@/contexts/ProxCenterTasksContext', () => ({ useProxCenterTasks: () => ({ addTask: h.addTask, updateTask: h.updateTask }) }))
vi.mock('./trackVdcMove', () => ({ trackVdcMove: h.track }))

import MoveVdcDialog, { formatMb } from './MoveVdcDialog'

const OPTIONS = {
  guest: {
    vmid: 105, name: 'web-01', running: true, vcpus: 2, memoryMb: 2048, totalDiskMb: 30720,
    storages: [{ storage: 'ceph-gold', disks: ['scsi0', 'efidisk0'], sizeMb: 20480 }, { storage: 'ceph-silver', disks: ['scsi1'], sizeMb: 10240 }],
    bridges: [{ bridge: 'tnet01', nics: ['net0'], tags: [] }],
  },
  sourceVdc: { id: 'vdc-src', name: 'Paris' },
  targets: [{ vdcId: 'vdc-dst', name: 'Lyon' }, { vdcId: 'vdc-3', name: 'Lille' }],
  target: {
    vdcId: 'vdc-dst',
    name: 'Lyon',
    storages: [
      { storage: 'nvme-gold', primary: false, policy: { name: 'Gold', iopsRd: 1000, iopsWr: 1000, mbpsRd: 200, mbpsWr: null }, quotaMb: 102400, usedMb: 2048 },
      { storage: 'rbd', primary: true, policy: null, quotaMb: null, usedMb: null },
    ],
    networks: [{ bridge: 'tnet01', label: 'lan', kind: 'vnet', stretched: true }, { bridge: 'vmbr1', label: 'WAN', kind: 'shared', stretched: false }],
    defaults: { storageMap: { 'ceph-gold': 'nvme-gold' }, bridgeMap: { tnet01: 'tnet01' } },
  },
  blockers: [],
}

const fetchMock = vi.fn()

function json(status: number, body: unknown) {
  return Promise.resolve({ ok: status < 400, status, json: async () => body })
}

afterEach(() => { cleanup() })

beforeEach(() => {
  vi.clearAllMocks()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

function renderDialog(onClose = vi.fn()) {
  renderWithProviders(<MoveVdcDialog open onClose={onClose} connId="conn-a" node="pve1" vmid={105} />)
  return onClose
}

function openSelect(label: string) {
  const combo = screen.getByRole('combobox', { name: label })
  fireEvent.mouseDown(combo)
  return screen.getByRole('listbox')
}

describe('MoveVdcDialog', () => {
  it('loads the options and pre-fills the mapping, one line per source storage and network', async () => {
    fetchMock.mockImplementation(() => json(200, { data: OPTIONS }))
    renderDialog()

    expect(await screen.findByText('Move web-01 (105) to another vDC')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/connections/conn-a/guests/qemu/pve1/105/move-vdc', { cache: 'no-store' })
    expect(screen.getByText('Paris')).toBeTruthy()
    expect(screen.getByText('ceph-gold · scsi0, efidisk0 · 20.0 GiB')).toBeTruthy()
    expect(screen.getByText('tnet01 · net0')).toBeTruthy()
    // ceph-silver has no default: the move stays disabled until it is mapped
    expect((screen.getByRole('button', { name: /^Move$/ }) as HTMLButtonElement).disabled).toBe(true)

    const list = openSelect('Target storage for ceph-silver')
    expect(within(list).getByText('Gold · nvme-gold · 1000/1000 IOPS · 200/∞ MB/s · 2.0 GiB / 100.0 GiB used')).toBeTruthy()
    fireEvent.click(within(list).getByText('Primary storage · rbd'))
    await waitFor(() => expect((screen.getByRole('button', { name: /^Move$/ }) as HTMLButtonElement).disabled).toBe(false))
  })

  it('reloads the target when another vDC is chosen', async () => {
    fetchMock.mockImplementation(() => json(200, { data: OPTIONS }))
    renderDialog()
    await screen.findByText('Paris')
    fireEvent.click(within(openSelect('Target vDC')).getByText('Lille'))
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/connections/conn-a/guests/qemu/pve1/105/move-vdc?targetVdcId=vdc-3', { cache: 'no-store' }))
  })

  it('shows the blockers in the user language and keeps the move disabled', async () => {
    fetchMock.mockImplementation(() => json(200, { data: { ...OPTIONS, blockers: [{ code: 'SNAPSHOTS_PRESENT', context: { count: 2 } }, { code: 'UNKNOWN_CODE' }] } }))
    renderDialog()
    expect(await screen.findByText('Delete the 2 snapshot(s) of the VM before the move.')).toBeTruthy()
    expect(screen.getByText('UNKNOWN_CODE')).toBeTruthy()
    expect((screen.getByRole('button', { name: /^Move$/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('starts the move, adds a ProxCenter task and closes', async () => {
    const onClose = vi.fn()
    fetchMock.mockImplementation((_url: string, init?: any) => init?.method === 'POST'
      ? json(202, { data: { moveId: 'm1' } })
      : json(200, { data: { ...OPTIONS, guest: { ...OPTIONS.guest, storages: [OPTIONS.guest.storages[0]] } } }))
    renderDialog(onClose)
    await screen.findByText('Paris')
    fireEvent.click(screen.getByRole('button', { name: /^Move$/ }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')!
    expect(JSON.parse(post[1].body)).toEqual({ targetVdcId: 'vdc-dst', storageMap: { 'ceph-gold': 'nvme-gold' }, bridgeMap: { tnet01: 'tnet01' }, online: true })
    expect(h.addTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'vdc-move-m1', label: 'Move web-01 to vDC Lyon', status: 'running' }))
    expect(h.track).toHaveBeenCalledWith('m1', expect.any(Function), expect.objectContaining({ done: 'Moved' }))
  })

  it('shows the blockers the server found at launch', async () => {
    fetchMock.mockImplementation((_url: string, init?: any) => init?.method === 'POST'
      ? json(409, { blockers: [{ code: 'QUOTA_EXCEEDED', details: ['VMs: 5/5 used'] }] })
      : json(200, { data: { ...OPTIONS, guest: { ...OPTIONS.guest, storages: [OPTIONS.guest.storages[0]], running: false } } }))
    renderDialog()
    expect(await screen.findByText('Offline (VM stopped)')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^Move$/ }))
    expect(await screen.findByText('The target vDC quota would be exceeded: VMs: 5/5 used')).toBeTruthy()
  })

  it('shows a load error', async () => {
    fetchMock.mockImplementation(() => json(404, { error: 'Guest not found' }))
    renderDialog()
    expect(await screen.findByText('Guest not found')).toBeTruthy()
  })
})

describe('formatMb', () => {
  it('picks the unit', () => {
    expect(formatMb(512)).toBe('512 MiB')
    expect(formatMb(1536)).toBe('1.5 GiB')
    expect(formatMb(2 * 1024 * 1024)).toBe('2.0 TiB')
  })
})
