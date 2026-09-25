/**
 * The bandwidth and IO pressure columns of VmsTable (#1011), fed by the
 * useDiskLatency index. The hook is mocked here so the table can be rendered
 * with a populated index without a license or an orchestrator; VmsTable.test
 * keeps the Community state where every one of these columns is hidden.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'
import VmsTable from '@/components/VmsTable'
import { vmRowsFixture } from '@/__tests__/fixtures/vmRows'
import type { DiskLatencyIndex } from '@/hooks/useDiskLatency'

const { indexMock } = vi.hoisted(() => ({ indexMock: vi.fn() }))

vi.mock('@/hooks/useDiskLatency', () => ({ useDiskLatency: () => indexMock() }))
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ loading: false, isFullClusterView: true }),
}))
vi.mock('@/contexts/LicenseContext', () => ({
  useLicense: () => ({ isEnterprise: true, hasFeature: () => true, loading: false }),
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

const disk = {
  disk: 'scsi0', storage: 'local-lvm', read_ms: 0.84, write_ms: 12.4,
  latency_ms: 8, read_ops: 10, write_ops: 20, read_bps: 1536, write_bps: 512,
  window_avg_ms: 6, window_max_ms: 15, window_full: true,
}

function index(overrides: Partial<DiskLatencyIndex> = {}): DiskLatencyIndex {
  return {
    guests: new Map([['conn1:100', { latencyMs: 8, windowMaxMs: 15, disks: [disk], readBps: 1536, writeBps: 512 }]]),
    storages: new Map(),
    pressures: new Map([['conn1:100', { some: 12.345, full: 0.5 }]]),
    windowMinutes: 5,
    available: true,
    pressureAvailable: true,
    ...overrides,
  }
}

beforeEach(() => {
  indexMock.mockReset().mockReturnValue(index())
})

afterEach(() => {
  cleanup()
})

describe('VmsTable - disk bandwidth and IO pressure columns (#1011)', () => {
  it('shows the read and write bandwidth and the IO pressure of the guests the index knows', () => {
    renderWithProviders(<VmsTable vms={vmRowsFixture} />)

    expect(screen.getByText('8 ms')).toBeInTheDocument()
    expect(screen.getByText('1.5 KB/s')).toBeInTheDocument()
    expect(screen.getByText('512 B/s')).toBeInTheDocument()
    expect(screen.getByText('12.3%')).toBeInTheDocument()
  })

  it('says what each icon-only header measures, in a tooltip', () => {
    renderWithProviders(<VmsTable vms={vmRowsFixture} />)

    expect(screen.getByLabelText(/^Disk latency: service time/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Disk read: bytes per second read/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Disk write: bytes per second written/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^IO pressure: share of the last 10 s/)).toBeInTheDocument()
  })

  it('has no IO pressure column while no guest reports one (PVE 8)', () => {
    indexMock.mockReturnValue(index({ pressures: new Map(), pressureAvailable: false }))

    renderWithProviders(<VmsTable vms={vmRowsFixture} />)

    expect(screen.getByText('1.5 KB/s')).toBeInTheDocument()
    expect(screen.queryByText('12.3%')).not.toBeInTheDocument()
  })

  it('has none of the columns while the index is empty (Community, or no orchestrator yet)', () => {
    indexMock.mockReturnValue(index({ guests: new Map(), pressures: new Map(), available: false, pressureAvailable: false }))

    renderWithProviders(<VmsTable vms={vmRowsFixture} />)

    expect(screen.queryByText('1.5 KB/s')).not.toBeInTheDocument()
    expect(screen.queryByText('12.3%')).not.toBeInTheDocument()
  })
})
