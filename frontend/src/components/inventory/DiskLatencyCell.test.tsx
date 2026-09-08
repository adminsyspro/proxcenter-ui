import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, userEvent, within } from '@/__tests__/setup/renderWithProviders'
import type { DiskLatency, StorageLatency } from '@/lib/orchestrator/client'

import { guestLatencyLines, GuestLatencyCell, StorageLatencyCell } from './DiskLatencyCell'

const { formatLatencyMock } = vi.hoisted(() => ({ formatLatencyMock: vi.fn() }))

vi.mock('@/lib/metrics/latency', () => ({ formatLatency: (ms: number) => formatLatencyMock(ms) }))

const disks: DiskLatency[] = [
  {
    disk: 'scsi0', storage: 'local-lvm', read_ms: 0.84, write_ms: 12.4,
    latency_ms: 8, read_ops: 10, write_ops: 20,
    window_avg_ms: 12.6, window_max_ms: 123456.7, window_full: true,
  },
  {
    disk: 'virtio1', read_ms: 0, write_ms: 2.6,
    latency_ms: 2, read_ops: 0, write_ops: 20,
    window_avg_ms: 1.4, window_max_ms: 9.6, window_full: true,
  },
]

beforeEach(async () => {
  const { formatLatency } = await vi.importActual<typeof import('@/lib/metrics/latency')>('@/lib/metrics/latency')

  formatLatencyMock.mockReset().mockImplementation(formatLatency)
})

afterEach(cleanup)

describe('guestLatencyLines', () => {
  it('includes known storage and formats read, write and maximum latency for each disk', () => {
    expect(guestLatencyLines(disks)).toEqual([
      'scsi0 · local-lvm: R 0.8 ms / W 12 ms, max 123457 ms',
      'virtio1: R 0.0 ms / W 3 ms, max 10 ms',
    ])
    expect(formatLatencyMock.mock.calls).toEqual([[0.84], [12.4], [123456.7], [0], [2.6], [9.6]])
  })
})

describe('GuestLatencyCell', () => {
  it('renders a dash without an entry', () => {
    renderWithProviders(<GuestLatencyCell />)

    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('renders formatted guest latency and one tooltip line per disk on hover', async () => {
    const user = userEvent.setup()

    renderWithProviders(<GuestLatencyCell entry={{ latencyMs: 12.6, windowMaxMs: 123456.7, disks }} />)

    const latency = screen.getByText('13 ms')

    expect(latency).toBeInTheDocument()
    expect(formatLatencyMock).toHaveBeenCalledWith(12.6)
    await user.hover(latency)
    const tooltip = await screen.findByRole('tooltip')
    const lines = within(tooltip).getAllByText(/: R /)

    expect(lines.map(line => line.textContent)).toEqual([
      'scsi0 · local-lvm: R 0.8 ms / W 12 ms, max 123457 ms',
      'virtio1: R 0.0 ms / W 3 ms, max 10 ms',
    ])
  })
})

describe('StorageLatencyCell', () => {
  it('renders a dash without an entry', () => {
    renderWithProviders(<StorageLatencyCell tooltip="Storage details" />)

    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('renders formatted storage latency and the supplied tooltip on hover', async () => {
    const user = userEvent.setup()
    const entry: StorageLatency = {
      storage: 'local-lvm', read_ms: 0.2, write_ms: 0.9, latency_ms: 0.84,
      window_avg_ms: 1.4, window_max_ms: 9.6, window_full: true, disks: 2, vms: 1,
    }

    renderWithProviders(<StorageLatencyCell entry={entry} tooltip="2 disks · 1 guest · max 10 ms" />)

    const latency = screen.getByText('0.8 ms')

    expect(latency).toBeInTheDocument()
    expect(formatLatencyMock).toHaveBeenCalledWith(0.84)
    await user.hover(latency)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('2 disks · 1 guest · max 10 ms')
  })
})
