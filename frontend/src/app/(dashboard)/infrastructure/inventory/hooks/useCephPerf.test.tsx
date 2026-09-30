import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act, cleanup } from '@testing-library/react'

import { useCephPerf } from './useCephPerf'

let visibility: DocumentVisibilityState = 'visible'

function setVisibility(state: DocumentVisibilityState) {
  visibility = state
  document.dispatchEvent(new Event('visibilitychange'))
}

const PGMAP = { read_bytes_sec: 1048576, write_bytes_sec: 524288, read_op_per_sec: 120, write_op_per_sec: 45 }

let fetchSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({ json: async () => ({ data: { pgmap: PGMAP } }) } as any)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useCephPerf', () => {
  it('fetches the Ceph status of the cluster connection immediately when the Ceph tab is active', async () => {
    const { result } = renderHook(() => useCephPerf('cluster', 'conn 1:extra', 7, { health: 'ok' }, 3600))

    await waitFor(() => expect(result.current.clusterCephPerf).not.toBeNull())

    expect(fetchSpy).toHaveBeenCalledWith('/api/v1/connections/conn%201/ceph/status', { cache: 'no-store' })
    expect(result.current.clusterCephPerf).toMatchObject({
      read_bytes_sec: 1048576,
      write_bytes_sec: 524288,
      read_op_per_sec: 120,
      write_op_per_sec: 45,
    })
    expect(result.current.clusterCephPerfFiltered).toHaveLength(1)
  })

  it('does not fetch when the Ceph tab is not active', () => {
    renderHook(() => useCephPerf('cluster', 'conn1', 2, { health: 'ok' }, 3600))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('refetches right away when the browser tab becomes visible again', async () => {
    const { result } = renderHook(() => useCephPerf('cluster', 'conn1', 7, { health: 'ok' }, 3600))

    await waitFor(() => expect(result.current.clusterCephPerfFiltered).toHaveLength(1))
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    act(() => setVisibility('hidden'))
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    act(() => setVisibility('visible'))

    await waitFor(() => expect(result.current.clusterCephPerfFiltered).toHaveLength(2))
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })
})
