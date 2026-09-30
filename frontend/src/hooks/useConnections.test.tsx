import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, cleanup } from '@testing-library/react'

import { useClusterConnections } from './useConnections'

const swrMock = vi.fn()

vi.mock('./useSWRFetch', () => ({
  useSWRFetch: (...a: any[]) => swrMock(...a),
}))

const CLUSTER = { id: 'conn-cluster', name: 'PVE-PROD' }
const STANDALONE = { id: 'conn-single', name: 'pve-lab' }
const BROKEN = { id: 'conn-broken', name: 'down' }
// Stable reference: the hook's effect depends on the SWR data identity.
const SWR_RESULT = { data: { data: [CLUSTER, STANDALONE, BROKEN] }, error: undefined, isLoading: false }

beforeEach(() => {
  swrMock.mockReturnValue(SWR_RESULT)
  vi.spyOn(global, 'fetch').mockImplementation(async (input: any) => {
    const url = String(input)

    if (url.includes('conn-cluster')) return { ok: true, json: async () => ({ data: [{ node: 'pve1' }, { node: 'pve2' }, { node: 'pve3' }] }) } as any
    if (url.includes('conn-single')) return { ok: true, json: async () => ({ data: [{ node: 'pve-lab' }] }) } as any

    return { ok: false, json: async () => ({}) } as any
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useClusterConnections', () => {
  it('keeps only the PVE connections that have two nodes or more', async () => {
    const { result } = renderHook(() => useClusterConnections())

    await waitFor(() => expect(result.current.data).toEqual({ data: [CLUSTER] }))
    expect(swrMock).toHaveBeenCalledWith('/api/v1/connections?type=pve', { revalidateOnFocus: true })
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/connections/conn-cluster/nodes')
  })
})
