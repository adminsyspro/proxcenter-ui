/**
 * The Disk column of VmsTable shows every disk of a guest (#938), not the
 * boot disk `maxdisk` carries, and a size for a VM PVE reports with maxdisk 0.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderWithProviders } from '@/__tests__/setup/renderWithProviders'
import VmsTable, { guestDiskBytes, type VmRow } from '@/components/VmsTable'

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

afterEach(() => {
  cleanup()
})

const G = 1024 ** 3

const row = (vmid: number, extra: Partial<VmRow>): VmRow => ({
  id: `conn1:pve1:qemu:${vmid}`,
  connId: 'conn1',
  node: 'pve1',
  vmid,
  name: `vm-${vmid}`,
  type: 'qemu',
  status: 'stopped',
  ...extra,
})

function diskCell(container: HTMLElement, vmid: number): string {
  const cell = container.querySelector(`[role="row"][data-id="conn1:pve1:qemu:${vmid}"] [data-field="disk"]`)

  return (cell?.textContent || '').trim()
}

describe('guestDiskBytes (#938)', () => {
  it('takes the sum of every disk over the boot disk', () => {
    expect(guestDiskBytes({ maxdisk: 20 * G, diskTotal: 36 * G })).toBe(36 * G)
  })

  it('falls back on maxdisk while no config was read', () => {
    expect(guestDiskBytes({ maxdisk: 20 * G })).toBe(20 * G)
  })

  it('never shows less than Proxmox reports', () => {
    expect(guestDiskBytes({ maxdisk: 20 * G, diskTotal: 0 })).toBe(20 * G)
  })

  it('is 0 with neither figure', () => {
    expect(guestDiskBytes({})).toBe(0)
  })
})

describe('VmsTable - Disk column (#938)', () => {
  it('shows the total of a multi-disk VM and a size for a VM whose maxdisk is 0', () => {
    const { container } = renderWithProviders(
      <VmsTable
        vms={[
          row(104, { name: 'NginX', maxdisk: 20 * G, diskTotal: 36 * G }),
          row(9938, { name: 'net-boot', maxdisk: 0, diskTotal: 3 * G }),
          row(105, { name: 'legacy', maxdisk: 16 * G }),
          row(106, { name: 'diskless', maxdisk: 0 }),
        ]}
      />
    )

    expect(diskCell(container, 104)).toBe('36G')
    expect(diskCell(container, 9938)).toBe('3G')
    expect(diskCell(container, 105)).toBe('16G')
    expect(diskCell(container, 106)).toBe('—')
  })
})
