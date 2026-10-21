/**
 * The Excel export of VmsTable carries the guest details (#1163), asked for
 * at click time since the rows do not have them.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { cleanup, fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@/__tests__/setup/renderWithProviders'
import VmsTable, { type VmRow } from '@/components/VmsTable'

const { addRow } = vi.hoisted(() => ({ addRow: vi.fn() }))

vi.mock('exceljs', () => {
  class Workbook {
    addWorksheet() {
      return { columns: [], addRow, getRow: () => ({}) }
    }

    xlsx = { writeBuffer: async () => new ArrayBuffer(8) }
  }

  return { Workbook, default: { Workbook } }
})
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ loading: false, isFullClusterView: true }),
}))
vi.mock('@/contexts/LicenseContext', () => ({
  useLicense: () => ({ isEnterprise: false, hasFeature: () => false, loading: false }),
}))
vi.mock('@/hooks/useRefreshInterval', () => ({ useRefreshInterval: () => 60000 }))
vi.mock('@/contexts/TagColorContext', () => ({
  useTagColors: () => ({
    getColor: () => ({ bg: '#1976d2', fg: '#ffffff' }),
    getOverride: () => undefined,
    getShape: () => 'full',
    loadConnection: vi.fn(),
  }),
}))

const rows: VmRow[] = [
  { id: 'c1:pve1:qemu:201', connId: 'c1', node: 'pve1', vmid: 201, name: 'win2022', type: 'qemu', status: 'running' },
  { id: 'c1:pve1:lxc:205', connId: 'c1', node: 'pve1', vmid: 205, name: 'ct', type: 'lxc', status: 'stopped' },
]

beforeEach(() => {
  addRow.mockReset()
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({
      data: {
        vms: [
          {
            connId: 'c1', type: 'qemu', node: 'pve1', vmid: '201', ostype: 'win11', bios: 'ovmf', machine: 'pc-q35-9.2+pve1',
            agentEnabled: true, agentResponding: true, agentVersion: '107.0.1', agentOsName: 'Microsoft Windows Server 2022 Standard',
            createdAt: 1760000000, uptimeSeconds: 3600,
          },
          { connId: 'c1', type: 'lxc', node: 'pve1', vmid: '205', ostype: 'alpine', bios: null, machine: null, agentEnabled: false, createdAt: null },
        ],
      },
    }),
  })))
  URL.createObjectURL = vi.fn(() => 'blob:x')
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('VmsTable Excel export (#1163)', () => {
  it('writes the guest OS, firmware, machine, agent, creation and last boot of each guest', async () => {
    const { getByTestId } = renderWithProviders(<VmsTable vms={rows} />)

    fireEvent.click(getByTestId('vms-export-excel'))

    await waitFor(() => expect(addRow).toHaveBeenCalledTimes(2))
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain('vmids=201%2C205')

    const [vm] = addRow.mock.calls[0]
    expect(vm).toMatchObject({
      os: 'Microsoft Windows Server 2022 Standard', bios: 'OVMF (UEFI)', machine: 'q35 9.2+pve1',
      agent: 'Running', agentversion: '107.0.1',
    })
    expect(vm.created).toEqual(new Date(1760000000 * 1000))
    expect(vm.lastboot).toBeInstanceOf(Date)

    const [ct] = addRow.mock.calls[1]
    expect(ct).toMatchObject({ os: 'alpine', bios: '', machine: '', agent: '', agentversion: '', created: '', lastboot: '' })

    await waitFor(() => expect(getByTestId('vms-export-excel').getAttribute('aria-busy')).toBe('false'))
  })
})
