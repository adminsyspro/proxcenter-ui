import React, { type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'

import { forgetSharedReads } from './api'
import { clustersKey, isClustersKey, useMicrosegGroup } from './useMicrosegGroup'

const fetchMock = vi.fn()
const reply = (status: number, body: unknown) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) })
const cluster = (connection_id: string, active = true) =>
  ({ connection_id, active, stop_cluster_disabled: false, policy_id: 'p', created_at: '', activated_at: null })

const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
)

beforeEach(() => {
  forgetSharedReads()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('useMicrosegGroup', () => {
  it('starts as the single connection before the first answer', () => {
    fetchMock.mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useMicrosegGroup('c2'), { wrapper })
    expect(result.current).toMatchObject({ anchor: 'c2', ids: ['c2'], shared: false, loading: true, max: undefined })
  })

  it.each(['c1', 'c2'])('anchors on the smallest id whichever one is passed (%s)', async (passed) => {
    fetchMock.mockResolvedValue(reply(200, { clusters: [cluster('c2'), cluster('c1', false)], max: 8 }))
    const { result } = renderHook(() => useMicrosegGroup(passed), { wrapper })
    await waitFor(() => expect(result.current.shared).toBe(true))
    expect(result.current.anchor).toBe('c1')
    expect(result.current.ids).toEqual(['c1', 'c2'])
    expect(result.current.activeIds).toEqual(['c2'])
    expect(result.current.clusters).toHaveLength(2)
    expect(result.current.max).toBe(8)
    expect(result.current.loading).toBe(false)
  })

  it('takes the lexicographically smallest id as the anchor (plain string sort)', async () => {
    fetchMock.mockResolvedValue(reply(200, { clusters: [cluster('b10'), cluster('b9'), cluster('a')], max: 8 }))
    const { result } = renderHook(() => useMicrosegGroup('b9'), { wrapper })
    await waitFor(() => expect(result.current.shared).toBe(true))
    expect(result.current.anchor).toBe('a')
    expect(result.current.ids).toEqual(['a', 'b10', 'b9'])
  })

  it('issues exactly one request for a single cluster', async () => {
    fetchMock.mockResolvedValue(reply(200, { clusters: [cluster('c1')], max: 8 }))
    const { result } = renderHook(() => useMicrosegGroup('c1'), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current).toMatchObject({ anchor: 'c1', ids: ['c1'], activeIds: ['c1'], shared: false })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/firewall/microseg/c1/clusters')
  })

  it('reads nothing without a connection', async () => {
    const { result } = renderHook(() => useMicrosegGroup(''), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('builds the key of a connection and recognises every clusters key', () => {
    expect(clustersKey('c 1')).toBe('/api/v1/firewall/microseg/c%201/clusters')
    expect(isClustersKey(clustersKey('c2'))).toBe(true)
    expect(isClustersKey('/api/v1/firewall/microseg/c2/policy')).toBe(false)
    expect(isClustersKey(['/api/v1/firewall/microseg/c2/clusters'])).toBe(false)
  })

  it('falls back to the single connection when the read fails', async () => {
    fetchMock.mockResolvedValue(reply(502, { code: 'ORCHESTRATOR_ERROR' }))
    const { result } = renderHook(() => useMicrosegGroup('c3'), { wrapper })
    await waitFor(() => expect(result.current.error).toBeTruthy())
    expect(result.current).toMatchObject({ anchor: 'c3', ids: ['c3'], activeIds: ['c3'], shared: false })
  })
})
