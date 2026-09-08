import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'

import type { DiskLatency, StorageLatency } from '@/lib/orchestrator/client'

import { useDiskLatency } from './useDiskLatency'

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

const disk: DiskLatency = {
  disk: 'scsi0', storage: 'local-lvm', read_ms: 0.84, write_ms: 12.4,
  latency_ms: 8, read_ops: 10, write_ops: 20,
  window_avg_ms: 6, window_max_ms: 15, window_full: true,
}
const storage: StorageLatency = {
  storage: 'local-lvm', read_ms: 0.84, write_ms: 12.4, latency_ms: 8,
  window_avg_ms: 6, window_max_ms: 15, window_full: true, disks: 1, vms: 1,
}
const vm = { vmid: 100, disk_latency_ms: 8, disk_latency_window_max_ms: 15, disk_latency: [disk] }

beforeEach(() => {
  swrMock.mockReset().mockReturnValue({ data: undefined })
  licenseMock.mockReset().mockReturnValue({ isEnterprise: true })
})

afterEach(cleanup)

describe('useDiskLatency', () => {
  it('disables fetching and returns an empty index for Community', () => {
    licenseMock.mockReturnValue({ isEnterprise: false })

    const { result } = renderHook(() => useDiskLatency())

    expect(swrMock).toHaveBeenCalledWith(null, { refreshInterval: 60000, revalidateOnFocus: false })
    expect(result.current).toEqual({ guests: new Map(), storages: new Map(), windowMinutes: 5, available: false })
  })

  it('polls the metrics endpoint and returns an empty index while loading', () => {
    const { result } = renderHook(() => useDiskLatency())

    expect(swrMock).toHaveBeenCalledWith('/api/v1/orchestrator/metrics', {
      refreshInterval: 60000, revalidateOnFocus: false,
    })
    expect(result.current).toEqual({ guests: new Map(), storages: new Map(), windowMinutes: 5, available: false })
  })

  it('indexes guests and storages by connection without collisions and reads the window', () => {
    swrMock.mockReturnValue({ data: {
      'conn-1': { connection_id: 'conn-1', vms: [vm], storages: [storage], disk_latency_window_minutes: 10 },
      'conn-2': {
        connection_id: 'conn-2', vms: [{ ...vm, disk_latency_ms: 2 }],
        storages: [{ ...storage, latency_ms: 3 }], disk_latency_window_minutes: 10,
      },
    } })

    const { result } = renderHook(() => useDiskLatency())

    expect(result.current.guests).toEqual(new Map([
      ['conn-1:100', { latencyMs: 8, windowMaxMs: 15, disks: [disk] }],
      ['conn-2:100', { latencyMs: 2, windowMaxMs: 15, disks: [disk] }],
    ]))
    expect(result.current.storages).toEqual(new Map([
      ['conn-1:local-lvm', storage], ['conn-2:local-lvm', { ...storage, latency_ms: 3 }],
    ]))
    expect(result.current.windowMinutes).toBe(10)
    expect(result.current.available).toBe(true)
  })

  it('leaves out a storage the orchestrator has not measured yet', () => {
    swrMock.mockReturnValue({ data: {
      'conn-1': { connection_id: 'conn-1', vms: [vm], storages: [{ ...storage, measured: false, latency_ms: 0 }] },
    } })

    const { result } = renderHook(() => useDiskLatency())

    expect(result.current.storages.size).toBe(0)
    expect(result.current.guests.size).toBe(1)
    expect(result.current.available).toBe(true)
  })

  it('defaults to five minutes and the current latency when the window fields are absent', () => {
    swrMock.mockReturnValue({ data: {
      'conn-1': { connection_id: 'conn-1', vms: [{ vmid: 100, disk_latency_ms: 0, disk_latency: [disk] }] },
    } })

    const { result } = renderHook(() => useDiskLatency())

    expect(result.current.windowMinutes).toBe(5)
    expect(result.current.guests.get('conn-1:100')).toEqual({ latencyMs: 0, windowMaxMs: 0, disks: [disk] })
    expect(result.current.available).toBe(true)
  })

  it('skips guests with empty or missing disks or non-numeric latency', () => {
    swrMock.mockReturnValue({ data: {
      'conn-1': { connection_id: 'conn-1', vms: [
        { ...vm, vmid: 101, disk_latency: [] },
        { ...vm, vmid: 102, disk_latency: undefined },
        { ...vm, vmid: 103, disk_latency: {} },
        { ...vm, vmid: 104, disk_latency_ms: '8' },
        { ...vm, vmid: 105, disk_latency_ms: undefined },
        { ...vm, vmid: 106, disk_latency_ms: null },
        vm,
      ] },
    } })

    const { result } = renderHook(() => useDiskLatency())

    expect([...result.current.guests.keys()]).toEqual(['conn-1:100'])
    expect(result.current.available).toBe(true)
  })

  it('is available with only storage latency and skips invalid storage entries', () => {
    swrMock.mockReturnValue({ data: {
      'conn-1': { connection_id: 'conn-1', storages: [
        null, { ...storage, storage: '' }, { ...storage, latency_ms: '8' }, storage,
      ] },
    } })

    const { result } = renderHook(() => useDiskLatency())

    expect(result.current.guests.size).toBe(0)
    expect(result.current.storages).toEqual(new Map([['conn-1:local-lvm', storage]]))
    expect(result.current.available).toBe(true)
  })

  it('remains unavailable for empty metrics, invalid record values and missing connection ids', () => {
    swrMock.mockReturnValue({ data: {
      empty: { connection_id: 'conn-1' }, missing: { vms: [vm], storages: [storage] },
      absent: null, invalid: 'unavailable',
    } })

    const { result } = renderHook(() => useDiskLatency())

    expect(result.current).toEqual({ guests: new Map(), storages: new Map(), windowMinutes: 5, available: false })
  })

  it('accepts an array payload', () => {
    swrMock.mockReturnValue({ data: [
      { connection_id: 'conn-1', vms: [vm], storages: [storage], disk_latency_window_minutes: 15 },
    ] })

    const { result } = renderHook(() => useDiskLatency())

    expect(result.current.guests.get('conn-1:100')).toEqual({ latencyMs: 8, windowMaxMs: 15, disks: [disk] })
    expect(result.current.storages.get('conn-1:local-lvm')).toEqual(storage)
    expect(result.current.windowMinutes).toBe(15)
    expect(result.current.available).toBe(true)
  })
})
