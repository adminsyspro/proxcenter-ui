import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'

import { clustersToRead, useMergedClusters, type ClusterRead } from './useMerged'

afterEach(cleanup)

/** A per-cluster read answered from `answers` (an Error fails the read, undefined is still loading). */
function reader(answers: Record<string, string | Error | undefined>) {
  const seen: (string | null)[] = []
  const useOne = (connId: string | null): ClusterRead<string> => {
    seen.push(connId)
    if (!connId) return { loading: false }
    const answer = answers[connId]
    if (answer instanceof Error) return { error: answer, loading: false }
    return answer === undefined ? { loading: true } : { data: answer, loading: false }
  }
  return { useOne, seen }
}

describe('useMergedClusters', () => {
  it('hands every read the refresh interval it is given, and none when it is given none', () => {
    const intervals: (number | undefined)[] = []
    const useOne = (connId: string | null, refreshMs?: number): ClusterRead<string> => {
      if (connId) intervals.push(refreshMs)
      return connId ? { data: connId, loading: false } : { loading: false }
    }
    renderHook(() => useMergedClusters(['c1', 'c2'], useOne, 5000))
    expect(intervals).toEqual([5000, 5000])
    intervals.length = 0
    renderHook(() => useMergedClusters(['c1'], useOne))
    expect(intervals).toEqual([undefined])
  })

  it('reads every cluster and keeps each answer under its connection', () => {
    const { useOne } = reader({ c1: 'one', c2: 'two' })
    const { result } = renderHook(() => useMergedClusters(['c1', 'c2'], useOne))
    expect(result.current.byCluster).toEqual({ c1: 'one', c2: 'two' })
    expect(result.current.errors).toEqual({})
    expect(result.current.loading).toBe(false)
  })

  it('keeps the other clusters when one read fails, the failed one under errors and without data', () => {
    const boom = new Error('unreachable')
    const { useOne } = reader({ c1: 'one', c2: boom })
    const { result } = renderHook(() => useMergedClusters(['c1', 'c2'], useOne))
    expect(result.current.byCluster).toEqual({ c1: 'one', c2: undefined })
    expect(result.current.errors).toEqual({ c2: boom })
    expect(result.current.loading).toBe(false)
  })

  it('is loading while one cluster has not answered', () => {
    const { useOne } = reader({ c1: 'one', c2: undefined })
    const { result } = renderHook(() => useMergedClusters(['c1', 'c2'], useOne))
    expect(result.current.loading).toBe(true)
  })

  it('calls the read a fixed number of times, the unused slots with null: one cluster reads only its own', () => {
    const { useOne, seen } = reader({ c1: 'one' })
    renderHook(() => useMergedClusters(['c1'], useOne))
    expect(seen.slice(0, 8)).toEqual(['c1', null, null, null, null, null, null, null])
  })

  it('keeps the same hooks when the group grows (no hook order error)', () => {
    const { useOne } = reader({ c1: 'one', c2: 'two' })
    const { result, rerender } = renderHook(({ ids }) => useMergedClusters(ids, useOne), { initialProps: { ids: ['c1'] } })
    expect(Object.keys(result.current.byCluster)).toEqual(['c1'])
    rerender({ ids: ['c1', 'c2'] })
    expect(result.current.byCluster).toEqual({ c1: 'one', c2: 'two' })
  })

  it('says a cluster past the slots cannot be read rather than dropping it silently', () => {
    const ids = Array.from({ length: 9 }, (_, i) => `c${i}`)
    const { useOne } = reader(Object.fromEntries(ids.map(id => [id, id])))
    const { result } = renderHook(() => useMergedClusters(ids, useOne))
    expect(Object.keys(result.current.errors)).toEqual(['c8'])
  })

  it('reloads every cluster read', () => {
    const reloads = { c1: vi.fn(), c2: vi.fn() }
    const useOne = (connId: string | null): ClusterRead<string> => (connId ? { data: connId, loading: false, reload: reloads[connId as 'c1' | 'c2'] } : { loading: false })
    const { result } = renderHook(() => useMergedClusters(['c1', 'c2'], useOne))
    result.current.reload()
    expect(reloads.c1).toHaveBeenCalledTimes(1)
    expect(reloads.c2).toHaveBeenCalledTimes(1)
  })
})

describe('useMergedClusters identity', () => {
  it('gives back the same object while nothing changed, even when each read hands a new reload function', () => {
    const data = { c1: 'one', c2: 'two' } as Record<string, string>
    const useOne = (connId: string | null): ClusterRead<string> => (connId ? { data: data[connId], loading: false, reload: () => connId } : { loading: false })
    const { result, rerender } = renderHook(() => useMergedClusters(['c1', 'c2'], useOne))
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })
})

describe('clustersToRead', () => {
  it('reads the connection alone for a screen that is not given the group', () => {
    expect(clustersToRead('c1', {})).toEqual(['c1'])
  })

  it('reads nothing while the group is still read, then every cluster of the group whatever the entry connection', () => {
    expect(clustersToRead('c2', { clusterIds: ['c2'], anchor: undefined })).toEqual([])
    expect(clustersToRead('c2', { clusterIds: ['c1', 'c2'], anchor: 'c1' })).toEqual(['c1', 'c2'])
  })
})
