import { describe, it, expect, afterEach, vi } from 'vitest'
import { cleanup, fireEvent } from '@testing-library/react'
import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

import type { StorageLatency } from '@/lib/orchestrator/client'

const licenseMock = vi.fn(() => ({ isEnterprise: true }))
const latencyMock = vi.fn()
const thresholdsMock = vi.fn(() => ({ data: { disk_latency_warning: 0, disk_latency_critical: 100 } }))

vi.mock('@/contexts/LicenseContext', () => ({ useLicense: () => licenseMock() }))
vi.mock('@/hooks/useDiskLatency', () => ({ useDiskLatency: () => latencyMock() }))
vi.mock('@/hooks/useAlerts', () => ({ useAlertThresholds: () => thresholdsMock() }))

import StorageLatencyWidget, { latencySeverity, selectStorageRows } from './StorageLatencyWidget'

/**
 * #881: the dashboard's Storage tab gets one line per PVE storage with the
 * guest disk latency the orchestrator measured. The widget must only list the
 * connections the RBAC-filtered `nodes` expose, sort slowest first, and paint
 * by the alert thresholds only when that alert family is switched on.
 */

afterEach(() => {
  cleanup()
  licenseMock.mockReset().mockReturnValue({ isEnterprise: true })
  thresholdsMock.mockReset().mockReturnValue({ data: { disk_latency_warning: 0, disk_latency_critical: 100 } })
})

const storage = (name: string, latency: number, extra: Partial<StorageLatency> = {}): StorageLatency => ({
  storage: name, latency_ms: latency, read_ms: latency / 2, write_ms: latency,
  window_avg_ms: latency, window_max_ms: latency * 2, window_full: true, measured: true, disks: 3, vms: 2, ...extra,
})

const index = {
  storages: new Map<string, StorageLatency>([
    ['c1:ZFS-Pool', storage('ZFS-Pool', 0.3)],
    ['c1:CephStoragePool', storage('CephStoragePool', 2.6)],
    ['c2:CephPoolDR', storage('CephPoolDR', 1.2)],
    // A connection the user's nodes do not expose: must never be listed.
    ['c9:Hidden', storage('Hidden', 50)],
  ]),
  guests: new Map(),
  windowMinutes: 5,
  available: true,
}

const data = {
  clusters: [{ id: 'c1', name: 'PVE-PROD' }, { id: 'c2', name: 'PVE-DR' }, { id: 'c9', name: 'Leaked' }],
  nodes: [
    { name: 'pve1', connectionId: 'c1', connection: 'PVE-PROD' },
    { name: 'pve1-dr', connectionId: 'c2', connection: 'PVE-DR' },
  ],
}

const render = (settings: Record<string, unknown> = {}, props: Record<string, unknown> = {}) =>
  renderWithProviders(
    <StorageLatencyWidget data={data} loading={false} config={{ settings }} onUpdateSettings={() => {}} {...props} />,
  )

describe('latencySeverity', () => {
  it('stays neutral while the alert family is off', () => {
    expect(latencySeverity(500, { disk_latency_warning: 0, disk_latency_critical: 100 })).toBe('none')
    expect(latencySeverity(500, undefined)).toBe('none')
  })

  it('grades against warning then critical', () => {
    const th = { disk_latency_warning: 5, disk_latency_critical: 20 }

    expect(latencySeverity(4.9, th)).toBe('ok')
    expect(latencySeverity(5, th)).toBe('warning')
    expect(latencySeverity(20, th)).toBe('critical')
  })
})

describe('selectStorageRows', () => {
  it('keeps the connections the nodes expose, slowest first', () => {
    const { rows, connections } = selectStorageRows(index, data)

    expect(rows.map(r => r.storage)).toEqual(['CephStoragePool', 'CephPoolDR', 'ZFS-Pool'])
    expect(rows[0].connectionName).toBe('PVE-PROD')
    expect(connections.map(c => c.id)).toEqual(['c1', 'c2'])
  })

  it('honours the persisted connection filter', () => {
    const { rows } = selectStorageRows(index, data, ['c2'])

    expect(rows.map(r => r.storage)).toEqual(['CephPoolDR'])
  })

  it('returns nothing without visible nodes or without an index', () => {
    expect(selectStorageRows(index, { clusters: data.clusters, nodes: [] }).rows).toEqual([])
    expect(selectStorageRows(undefined, data).rows).toEqual([])
  })
})

describe('StorageLatencyWidget', () => {
  it('shows the Enterprise placeholder on a Community licence', () => {
    licenseMock.mockReturnValue({ isEnterprise: false })
    latencyMock.mockReturnValue({ storages: new Map(), guests: new Map(), windowMinutes: 5, available: false })
    render()

    expect(screen.getByText('Enterprise')).toBeInTheDocument()
    expect(screen.queryByTestId('storage-latency-row')).not.toBeInTheDocument()
  })

  it('lists one line per storage with its connection and latency, slowest first', () => {
    latencyMock.mockReturnValue(index)
    render()

    const rows = screen.getAllByTestId('storage-latency-row')

    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('CephStoragePool')
    expect(rows[0]).toHaveTextContent('PVE-PROD')
    expect(rows[0]).toHaveTextContent('3 ms')
    expect(rows[2]).toHaveTextContent('ZFS-Pool')
    expect(rows[2]).toHaveTextContent('0.3 ms')
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument()
    expect(screen.getByText('Storage latency')).toBeInTheDocument()
  })

  it('explains an empty list and offers to reset a persisted filter', () => {
    latencyMock.mockReturnValue(index)
    const onUpdateSettings = vi.fn()
    render({ selectedConnections: ['c9'] }, { onUpdateSettings })

    expect(screen.getByText(/No storage latency yet/i)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Reset'))
    expect(onUpdateSettings).toHaveBeenCalledWith({ selectedConnections: [] })
  })

  it('shows a spinner while the dashboard payload loads', () => {
    latencyMock.mockReturnValue(index)
    render({}, { loading: true })

    expect(screen.getByRole('progressbar')).toBeInTheDocument()
  })
})
