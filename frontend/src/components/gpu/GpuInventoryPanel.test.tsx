import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { fireEvent, renderWithProviders, screen, waitFor } from '@/__tests__/setup/renderWithProviders'
import type { GpuReport } from '@/lib/gpu/report'

import GpuInventoryPanel, { deviceLabel, deviceStatus } from './GpuInventoryPanel'
import GpuCapacityWidget from '../dashboard/widgets/GpuCapacityWidget'

const cap = (total: number, allocated: number, inUse: number, consoles: number) => ({ total, allocated, free: total - allocated, inUse, consoles })

const baseDevice = {
  connId: 'c1', connectionName: 'PROD', slot: '0000:01:00', functions: ['0000:01:00.0', '0000:01:00.1'], displayFunctions: ['0000:01:00.0'],
  vendorId: '0x10de', deviceId: '0x2204', vendorName: 'NVIDIA Corporation', deviceName: 'GA102', subsystemName: 'ASUS', classCode: '0x030000',
  iommuGroup: 14, iommuIsolated: true, mdev: false, vgpu: null, kind: 'gpu' as const, consoleReason: null, mappings: [] as string[],
}

const INFRA: GpuReport = {
  scope: 'infrastructure',
  generatedAt: '2026-10-14T08:00:00.000Z',
  connections: [{ id: 'c1', name: 'PROD', error: null, capacity: cap(2, 1, 1, 1) }],
  nodes: [
    { connId: 'c1', connectionName: 'PROD', node: 'n1', online: true, error: null, capacity: cap(2, 1, 1, 1) },
    { connId: 'c1', connectionName: 'PROD', node: 'n2', online: false, error: null, capacity: cap(0, 0, 0, 0) },
  ],
  devices: [
    { ...baseDevice, key: 'c1:n1:0000:01:00', node: 'n1', id: '0000:01:00.0', mappings: ['rtx'], vms: [{ vmid: '100', vmName: 'ml-train', vmStatus: 'running', hidden: false, template: false, hostpci: 'hostpci0', via: 'mapping', mdev: null, pooled: true }] },
    { ...baseDevice, key: 'c1:n1:0000:41:00', node: 'n1', id: '0000:41:00.0', slot: '0000:41:00', deviceName: 'GA100', mdev: true, vgpu: null, iommuIsolated: false, vms: [] },
    { ...baseDevice, key: 'c1:n1:0000:03:00', node: 'n1', id: '0000:03:00.0', slot: '0000:03:00', vendorId: '0x1a03', deviceId: '0x2000', vendorName: null, deviceName: null, iommuGroup: null, kind: 'console', consoleReason: 'vendor', vms: [] },
  ],
  allocations: [
    { connId: 'c1', connectionName: 'PROD', node: 'n1', vmid: '100', vmName: 'ml-train', vmStatus: 'running', template: false, hidden: false, hostpci: 'hostpci0', via: 'mapping', mapping: 'rtx', mdev: null, pooled: true, pool: null, uptime: 3600, smbiosUuid: null, pendingRemoval: false, kind: 'gpu', vendorName: 'NVIDIA Corporation', deviceName: 'GA102', vendorId: '0x10de', deviceId: '0x2204', deviceKey: 'c1:n1:0000:01:00', pciId: '0000:01:00.0' },
    { connId: 'c1', connectionName: 'PROD', node: 'n1', vmid: null, vmName: null, vmStatus: null, template: false, hidden: true, hostpci: null, via: 'address', mapping: null, mdev: 'nvidia-63', pooled: false, pool: null, uptime: null, smbiosUuid: null, pendingRemoval: false, kind: 'console', vendorName: null, deviceName: null, vendorId: '0x1a03', deviceId: '0x2000', deviceKey: 'c1:n1:0000:03:00', pciId: '0000:03:00.0' },
  ],
  capacity: cap(2, 1, 1, 1),
}

const TENANT: GpuReport = {
  scope: 'tenant', generatedAt: INFRA.generatedAt, connections: [{ id: 'c1', name: 'PROD', error: null, capacity: null }],
  nodes: [], devices: [], capacity: null,
  allocations: [{ ...INFRA.allocations[0], mapping: null, deviceKey: null, pciId: null, pooled: false }],
}

const fetchMock = vi.fn()

function serve(report: GpuReport | null, status = 200) {
  fetchMock.mockResolvedValue({ ok: status < 400, status, json: async () => (report ? { data: report } : { error: 'boom' }) })
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  fetchMock.mockReset()
  vi.unstubAllGlobals()
})

describe('deviceLabel and deviceStatus', () => {
  it('falls back on the PCI IDs and derives the status from the VMs', () => {
    expect(deviceLabel({ vendorName: null, deviceName: null, vendorId: '0x1234', deviceId: '0x1111' })).toBe('1234:1111')
    expect(deviceLabel({ vendorName: null, deviceName: null, vendorId: null, deviceId: null })).toBe('?')
    expect(deviceStatus({ kind: 'console', vms: [] })).toBe('console')
    expect(deviceStatus({ kind: 'gpu', vms: [] })).toBe('free')
    expect(deviceStatus({ kind: 'gpu', vms: [{ vmStatus: 'stopped' }] as any })).toBe('allocated')
    expect(deviceStatus({ kind: 'gpu', vms: [{ vmStatus: 'running' }] as any })).toBe('inUse')
  })
})

describe('GpuInventoryPanel', () => {
  it('cluster view: capacity per node, GPUs only until the console switch is on', async () => {
    serve(INFRA)
    renderWithProviders(<GpuInventoryPanel connId='c1' />)
    await screen.findByText('Capacity per node')
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/gpu?connId=c1', { cache: 'no-store' })
    expect(screen.getByTestId('gpu-tile-total').textContent).toContain('2')
    expect(screen.getAllByTestId('gpu-capacity-row')).toHaveLength(2)
    expect(screen.getByText('offline')).toBeTruthy()
    expect(screen.getAllByTestId('gpu-device-row')).toHaveLength(2)
    expect(screen.getAllByTestId('gpu-allocation-row')).toHaveLength(1)
    expect(screen.getByText('Mapping rtx')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Show console controllers (1)'))
    expect(screen.getAllByTestId('gpu-device-row')).toHaveLength(3)
    expect(screen.getAllByTestId('gpu-allocation-row')).toHaveLength(2)
    expect(screen.getAllByText('VM outside your scope').length).toBeGreaterThan(0)
    expect(screen.getByText('1a03:2000')).toBeTruthy()
  })

  it('opens the details of a device', async () => {
    serve(INFRA)
    renderWithProviders(<GpuInventoryPanel connId='c1' />)
    await screen.findByText('Capacity per node')
    fireEvent.click(screen.getAllByLabelText('Details')[1])
    expect(await screen.findByText('Supported')).toBeTruthy()
    expect(screen.getByText('14, shared with other devices')).toBeTruthy()
    fireEvent.click(screen.getAllByLabelText('Details')[0])
    expect(await screen.findByText('rtx')).toBeTruthy()
    expect(screen.getByText('14, isolated')).toBeTruthy()
  })

  it('node view: no capacity table, the refresh button bypasses the cache', async () => {
    serve(INFRA)
    renderWithProviders(<GpuInventoryPanel connId='c1' node='n1' />)
    await screen.findByText('Devices')
    expect(screen.queryByText('Capacity per node')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/gpu?connId=c1&node=n1&refresh=1', { cache: 'no-store' }))
  })

  it('says when no GPU is visible and how many consoles are hidden', async () => {
    serve({ ...INFRA, devices: [INFRA.devices[2]], allocations: [], capacity: cap(0, 0, 0, 1) })
    renderWithProviders(<GpuInventoryPanel />)
    expect(await screen.findByText(/No GPU found on the visible nodes\. 1 console controller is hidden\./)).toBeTruthy()
    expect(screen.getByText('Capacity per cluster')).toBeTruthy()
    expect(screen.getByText('No GPU is assigned to a VM.')).toBeTruthy()
  })

  it('tenant scope: only the allocations of its VMs, no inventory', async () => {
    serve(TENANT)
    renderWithProviders(<GpuInventoryPanel connId='c1' />)
    expect(await screen.findByText('GPUs assigned to your VMs')).toBeTruthy()
    expect(screen.queryByText('Devices')).toBeNull()
    expect(screen.queryByText(/Show console controllers/)).toBeNull()
    expect(screen.getByText('ml-train')).toBeTruthy()
    expect(screen.getByText('Resource mapping')).toBeTruthy()
  })

  it('tenant scope without GPU, and a load error', async () => {
    serve({ ...TENANT, allocations: [] })
    renderWithProviders(<GpuInventoryPanel />)
    expect(await screen.findByText('None of your VMs has a GPU assigned.')).toBeTruthy()
    cleanup()
    serve(null, 500)
    renderWithProviders(<GpuInventoryPanel />)
    expect(await screen.findByText(/Could not load the GPU inventory: boom/)).toBeTruthy()
  })
})

describe('GpuCapacityWidget', () => {
  it('shows the global figures and one bar per cluster', async () => {
    serve({ ...INFRA, connections: [...INFRA.connections, { id: 'c2', name: 'DR', error: 'down', capacity: null }] })
    renderWithProviders(<GpuCapacityWidget />)
    await screen.findByTestId('gpu-widget')
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/gpu', { cache: 'no-store' })
    expect(screen.getByTestId('gpu-widget-free').textContent).toContain('1')
    expect(screen.getByText('1 / 2')).toBeTruthy()
    expect(screen.getByText('Unreachable')).toBeTruthy()
  })

  it('leaves out the clusters without GPU, keeps the unreadable ones', async () => {
    serve({
      ...INFRA,
      connections: [
        ...INFRA.connections,
        { id: 'c2', name: 'NOGPU', error: null, capacity: cap(0, 0, 0, 0) },
        { id: 'c3', name: 'DR', error: 'down', capacity: null },
      ],
    })
    renderWithProviders(<GpuCapacityWidget />)
    await screen.findByTestId('gpu-widget')
    expect(screen.getByText('PROD')).toBeTruthy()
    expect(screen.getByText('DR')).toBeTruthy()
    expect(screen.queryByText('NOGPU')).toBeNull()
  })

  it('says so when no cluster holds a GPU', async () => {
    serve({ ...INFRA, capacity: cap(0, 0, 0, 0), connections: [{ id: 'c2', name: 'NOGPU', error: null, capacity: cap(0, 0, 0, 0) }] })
    renderWithProviders(<GpuCapacityWidget />)
    expect(await screen.findByText('No GPU found on the visible nodes.')).toBeTruthy()
    expect(screen.queryByText('NOGPU')).toBeNull()
  })

  it('tenant: counts the GPUs of its VMs', async () => {
    serve(TENANT)
    renderWithProviders(<GpuCapacityWidget />)
    expect(await screen.findByText('1 GPU on your VMs')).toBeTruthy()
    expect(screen.getByText('NVIDIA Corporation GA102')).toBeTruthy()
  })

  it('reports a load error', async () => {
    serve(null, 500)
    renderWithProviders(<GpuCapacityWidget />)
    expect(await screen.findByText(/Could not load the GPU inventory: boom/)).toBeTruthy()
  })
})
