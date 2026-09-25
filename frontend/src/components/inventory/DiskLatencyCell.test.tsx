import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, userEvent, within } from '@/__tests__/setup/renderWithProviders'
import type { DiskLatency, StorageLatency } from '@/lib/orchestrator/client'

import { guestBandwidthLines, guestLatencyLines, GuestBandwidthCell, GuestIoPressureCell, GuestLatencyCell, StorageBandwidthCell, StorageLatencyCell } from './DiskLatencyCell'

const { formatLatencyMock } = vi.hoisted(() => ({ formatLatencyMock: vi.fn() }))

vi.mock('@/lib/metrics/latency', () => ({ formatLatency: (ms: number) => formatLatencyMock(ms) }))

const disks: DiskLatency[] = [
  {
    disk: 'scsi0', storage: 'local-lvm', read_ms: 0.84, write_ms: 12.4,
    latency_ms: 8, read_ops: 10, write_ops: 20, read_bps: 1536, write_bps: 512,
    window_avg_ms: 12.6, window_max_ms: 123456.7, window_full: true,
  },
  {
    disk: 'virtio1', read_ms: 0, write_ms: 2.6,
    latency_ms: 2, read_ops: 0, write_ops: 20, read_bps: 0, write_bps: 3.5 * 1024 * 1024,
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

describe('guestBandwidthLines', () => {
  it('formats read and write bandwidth for each disk, with the storage when known (#1011)', () => {
    expect(guestBandwidthLines(disks)).toEqual([
      'scsi0 · local-lvm: R 1.5 KB/s / W 512 B/s',
      'virtio1: R 0 B/s / W 3.5 MB/s',
    ])
  })
})

describe('GuestBandwidthCell', () => {
  const entry = { latencyMs: 12.6, windowMaxMs: 123456.7, disks, readBps: 1536, writeBps: 3.5 * 1024 * 1024 + 512 }

  it('renders a dash without an entry, and without a figure for the direction', () => {
    renderWithProviders(<><GuestBandwidthCell direction="read" /><GuestBandwidthCell direction="write" entry={{ ...entry, writeBps: undefined }} /></>)

    expect(screen.getAllByText('—')).toHaveLength(2)
  })

  it('renders the guest total for its direction and one tooltip line per disk on hover', async () => {
    const user = userEvent.setup()

    renderWithProviders(<><GuestBandwidthCell direction="read" entry={entry} /><GuestBandwidthCell direction="write" entry={entry} /></>)

    const read = screen.getByText('1.5 KB/s')

    expect(read).toBeInTheDocument()
    expect(screen.getByText('3.5 MB/s')).toBeInTheDocument()
    await user.hover(read)
    const tooltip = await screen.findByRole('tooltip')
    const lines = within(tooltip).getAllByText(/: R /)

    expect(lines.map(line => line.textContent)).toEqual([
      'scsi0 · local-lvm: R 1.5 KB/s / W 512 B/s',
      'virtio1: R 0 B/s / W 3.5 MB/s',
    ])
  })
})

describe('GuestIoPressureCell', () => {
  it('renders a dash without a reading', () => {
    renderWithProviders(<GuestIoPressureCell tooltip="unused" />)

    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('renders the "some" share and the supplied tooltip on hover', async () => {
    const user = userEvent.setup()

    renderWithProviders(<GuestIoPressureCell pressure={{ some: 12.345, full: 0.5 }} tooltip="some 12.3% · full 0.5%" />)

    const some = screen.getByText('12.3%')

    expect(some).toBeInTheDocument()
    await user.hover(some)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('some 12.3% · full 0.5%')
  })
})

describe('StorageBandwidthCell', () => {
  const entry: StorageLatency = {
    storage: 'local-lvm', read_ms: 0.2, write_ms: 0.9, latency_ms: 0.84, read_bps: 1536, write_bps: 0,
    window_avg_ms: 1.4, window_max_ms: 9.6, window_full: true, disks: 2, vms: 1,
  }

  it('renders a dash without an entry', () => {
    renderWithProviders(<StorageBandwidthCell direction="read" tooltip="Storage details" />)

    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('renders the storage figure for its direction and the supplied tooltip on hover', async () => {
    const user = userEvent.setup()

    renderWithProviders(<><StorageBandwidthCell direction="read" entry={entry} tooltip="2 disks · 1 guest" /><StorageBandwidthCell direction="write" entry={entry} tooltip="2 disks · 1 guest" /></>)

    const read = screen.getByText('1.5 KB/s')

    expect(read).toBeInTheDocument()
    expect(screen.getByText('0 B/s')).toBeInTheDocument()
    await user.hover(read)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('2 disks · 1 guest')
  })

  it('renders a dash for a storage the orchestrator predates the bandwidth figures on', () => {
    const { read_bps: _r, write_bps: _w, ...legacy } = entry

    renderWithProviders(<StorageBandwidthCell direction="read" entry={legacy as StorageLatency} tooltip="" />)

    expect(screen.getByText('—')).toBeInTheDocument()
  })
})
