import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'

import type { DiskLatencySeries } from '@/lib/orchestrator/client'

import { useVmDiskLatencySeries } from './useVmDiskLatencySeries'

const { swrMock, licenseMock } = vi.hoisted(() => ({
  swrMock: vi.fn(),
  licenseMock: vi.fn(),
}))

vi.mock('@/hooks/useSWRFetch', () => ({
  useSWRFetch: (...a: any[]) => swrMock(...a),
  fetcher: vi.fn(),
  redirectToLoginOnce: vi.fn(),
}))
vi.mock('@/contexts/LicenseContext', () => ({ useLicense: () => licenseMock() }))
vi.mock('@/hooks/useRefreshInterval', () => ({ useRefreshInterval: () => 60000 }))

const start = Date.parse('2026-09-08T12:00:15.000Z')
const series = [0, 60000, 120000].map((offset, i) => ({ t: start + offset, diskReadBps: i * 100 }))
const args = { connId: 'conn-1', node: 'pve-1', vmid: 100, type: 'qemu', series }
const options = { refreshInterval: 60000, revalidateOnFocus: false }

beforeEach(() => {
  swrMock.mockReset().mockReturnValue({ data: undefined })
  licenseMock.mockReset().mockReturnValue({ isEnterprise: true })
})

afterEach(cleanup)

describe('useVmDiskLatencySeries', () => {
  it('disables fetching for Community and returns the series untouched with no disks', () => {
    licenseMock.mockReturnValue({ isEnterprise: false })

    const { result } = renderHook(() => useVmDiskLatencySeries(args))

    expect(swrMock).toHaveBeenCalledWith(null, options)
    expect(result.current).toStrictEqual({ data: series, disks: [] })
  })

  it('disables fetching for LXC guests', () => {
    const { result } = renderHook(() => useVmDiskLatencySeries({ ...args, type: 'lxc' }))

    expect(swrMock).toHaveBeenCalledWith(null, options)
    expect(result.current).toStrictEqual({ data: series, disks: [] })
  })

  it('requests one-minute buckets with aligned ISO bounds for enterprise QEMU guests', () => {
    const { result } = renderHook(() => useVmDiskLatencySeries(args))

    expect(swrMock).toHaveBeenCalledWith(
      '/api/v1/orchestrator/metrics/conn-1/vms/100/disk-latency' +
      '?node=pve-1&from=2026-09-08T12:00:00.000Z&to=2026-09-08T12:03:00.000Z&step=60',
      options,
    )
    expect(result.current).toStrictEqual({ data: series, disks: [] })
  })

  it('merges fetched scsi0 latency values at the matching buckets', () => {
    const latency: DiskLatencySeries = {
      step: 60,
      points: [8, 4, 2].map((value, i) => ({
        time: Date.parse('2026-09-08T12:00:00.000Z') / 1000 + i * 60,
        disk: 'scsi0', latency_ms: value, max_ms: value + 1, read_ops: 10, write_ops: 20,
      })),
    }
    swrMock.mockReturnValue({ data: latency })

    const { result } = renderHook(() => useVmDiskLatencySeries(args))

    expect(result.current).toStrictEqual({
      data: [
        { ...series[0], lat_scsi0: 8 },
        { ...series[1], lat_scsi0: 4 },
        { ...series[2], lat_scsi0: 2 },
      ],
      disks: ['scsi0'],
    })
  })

  it('URI-encodes a colon in the connection ID', () => {
    renderHook(() => useVmDiskLatencySeries({ ...args, connId: 'cluster:primary' }))

    expect(swrMock).toHaveBeenCalledWith(
      '/api/v1/orchestrator/metrics/cluster%3Aprimary/vms/100/disk-latency' +
      '?node=pve-1&from=2026-09-08T12:00:00.000Z&to=2026-09-08T12:03:00.000Z&step=60',
      options,
    )
  })
})
