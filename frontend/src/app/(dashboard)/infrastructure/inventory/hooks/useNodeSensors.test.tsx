import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'

import { useNodeSensors } from './useNodeSensors'

afterEach(cleanup)

const AVAILABLE = {
  data: {
    available: true,
    readings: [{ id: 'hwmon3', chip: 'k10temp', label: 'Tctl', celsius: 59.6, role: 'cpu' }],
    byRole: [{ role: 'cpu', max: 59.6, count: 1 }],
    hottest: { id: 'hwmon3', chip: 'k10temp', label: 'Tctl', celsius: 59.6, role: 'cpu' },
  },
}

const jsonResponse = (body: unknown) => ({ ok: true, json: async () => body }) as Response

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('useNodeSensors', () => {
  it('exposes the readings of a node that reports some', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(AVAILABLE)))

    const { result } = renderHook(() => useNodeSensors('c1', 'pve1'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.sensors?.byRole).toEqual([{ role: 'cpu', max: 59.6, count: 1 }])
  })

  it('calls the sensors route of the selected node', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(AVAILABLE))

    vi.stubGlobal('fetch', fetchMock)
    renderHook(() => useNodeSensors('c1', 'pve 1'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/connections/c1/nodes/pve%201/sensors')
  })

  it('stays empty for a node that reports nothing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: { available: false, reason: 'no-sensors' } })))

    const { result } = renderHook(() => useNodeSensors('c1', 'pve1'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.sensors).toBeNull()
  })

  it('stays empty when the route fails rather than surfacing an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    const { result } = renderHook(() => useNodeSensors('c1', 'pve1'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.sensors).toBeNull()
  })

  it('fetches nothing when the selection is not a node', async () => {
    const fetchMock = vi.fn()

    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useNodeSensors(undefined, undefined))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current).toEqual({ sensors: null, loading: false })
  })

  it('drops the previous node readings as soon as the node changes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(AVAILABLE)))

    const { result, rerender } = renderHook(({ node }) => useNodeSensors('c1', node), {
      initialProps: { node: 'pve1' },
    })

    await waitFor(() => expect(result.current.sensors).not.toBeNull())

    // Keeping them would attribute one host's temperature to another.
    rerender({ node: 'pve2' })
    expect(result.current.sensors).toBeNull()
  })
})
