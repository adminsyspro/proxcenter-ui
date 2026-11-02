import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'

import { jsonRes } from './testUtils'
import { useCephCrush } from './useCephCrush'
import { useCephHistory } from './useCephHistory'
import { useCephPoolStorages } from './useCephPoolStorages'

const fetchMock = vi.fn()

vi.mock('@/hooks/usePageVisibility', () => ({ usePageVisible: () => true }))

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// C1: the SWR cache is global; a value the cockpit transforms must never share a key with the raw URL another screen may cache.
describe('cockpit hooks use their own SWR keys', () => {
  const withCache = (entries: Record<string, unknown>) => {
    const cache = new Map<string, unknown>(Object.entries(entries).map(([k, v]) => [k, { data: v, isValidating: false }]))

    return ({ children }: { children: React.ReactNode }) => <SWRConfig value={{ provider: () => cache as never }}>{children}</SWRConfig>
  }

  it('pool storages ignore the raw /storage body cached under the URL', async () => {
    fetchMock.mockResolvedValue(jsonRes([{ storage: 'rbd1', type: 'rbd', pool: 'p' }]))
    const { result } = renderHook(() => useCephPoolStorages('c1'), { wrapper: withCache({ '/api/v1/connections/c1/storage': { data: [{ storage: 'x' }] } }) })

    expect(result.current.storages).toBeNull()
    await waitFor(() => expect(result.current.storages).toEqual({ p: ['rbd1'] }))
  })

  it('crush ignores a raw value cached under its URL', async () => {
    const { result } = renderHook(() => useCephCrush('c1', true), { wrapper: withCache({ '/api/v1/connections/c1/ceph/crush': { data: { tree: [] } } }) })

    expect(result.current.crush).toBeNull()
  })

  it('history ignores a raw value cached under its URL', async () => {
    const url = '/api/v1/orchestrator/ceph/c1/history?range=1h'
    const { result } = renderHook(() => useCephHistory('c1', '1h', true), { wrapper: withCache({ [url]: { data: { points: [], slowest_osds: [] } } }) })

    expect(result.current.history).toBeNull()
  })
})
