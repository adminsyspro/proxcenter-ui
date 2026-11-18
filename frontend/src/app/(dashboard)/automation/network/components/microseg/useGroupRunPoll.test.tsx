/**
 * Following the run of each cluster of a group action: each through its own cluster, nothing while the tab is hidden.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'

import { forgetSharedReads } from '@/lib/microseg/api'
import type { GroupRun, MicrosegRun } from '@/lib/microseg/types'

import { RUN_READ_MAX_FAILURES, polledOutcome, useGroupRunPoll } from './useGroupRunPoll'

const fetchMock = vi.fn()
const reply = (status: number, body: unknown) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) })
const done = (id: string, connectionId: string, status: MicrosegRun['status'] = 'done'): MicrosegRun => ({
  id, policy_id: 'p1', connection_id: connectionId, kind: 'apply', status, started_at: '2026-11-02T10:00:00Z', duration_ms: 0, api_calls: 0, writes: 0, result: null, error: '',
})
const read = () => fetchMock.mock.calls.map(([u]) => /microseg\/([^/]+)\/runs\/([^/?]+)/.exec(u as string)?.slice(1).join('/'))

let hidden = false

beforeEach(() => {
  hidden = false
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  fetchMock.mockReset()
  forgetSharedReads()
  fetchMock.mockImplementation(async (url: string) => {
    const [, conn, id] = /microseg\/([^/]+)\/runs\/([^/?]+)/.exec(url) ?? []
    return reply(200, done(id, conn, id === 'r2' ? 'failed' : 'done'))
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const GROUP: GroupRun[] = [{ connection_id: 'c1', run_id: 'r1' }, { connection_id: 'c2', run_id: 'r2' }, { connection_id: 'c3', error: 'no_client' }]

describe('useGroupRunPoll', () => {
  it('reads each run through its own cluster, never a cluster whose run did not start', async () => {
    const { result } = renderHook(() => useGroupRunPoll(GROUP))
    await waitFor(() => expect(result.current.every(r => r.ended)).toBe(true))
    expect(read().sort()).toEqual(['c1/r1', 'c2/r2'])
    expect(result.current.map(r => r.run?.status ?? r.error)).toEqual(['done', 'failed', 'no_client'])
    expect(polledOutcome(result.current)).toBe('partial')
  })

  it('reads nothing while the tab is hidden and starts when it is shown', async () => {
    hidden = true
    const { result } = renderHook(() => useGroupRunPoll(GROUP))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(fetchMock).not.toHaveBeenCalled()
    hidden = false
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    await waitFor(() => expect(result.current.filter(r => r.run).length).toBe(2))
  })

  it('reads a single cluster even while the tab is hidden, as one run was always read', async () => {
    hidden = true
    const { result } = renderHook(() => useGroupRunPoll([{ connection_id: 'c1', run_id: 'r1' }]))
    await waitFor(() => expect(result.current[0].run?.status).toBe('done'))
  })

  it('reads nothing without runs', () => {
    const { result } = renderHook(() => useGroupRunPoll(null))
    expect(result.current).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ends a run whose read fails for good, and counts it as failed', async () => {
    fetchMock.mockImplementation(async (url: string) => (url.includes('/c2/')
      ? reply(403, { code: 'FORBIDDEN', error: 'x' })
      : reply(200, done('r1', 'c1'))))
    const { result } = renderHook(() => useGroupRunPoll(GROUP.slice(0, 2)))
    await waitFor(() => expect(result.current.every(r => r.ended)).toBe(true))
    expect(result.current[1]).toMatchObject({ fatal: true, abandoned: false, ended: true, run: null })
    expect(polledOutcome(result.current)).toBe('partial')
  })

  it('gives up a run of a group after RUN_READ_MAX_FAILURES failed reads in a row', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      fetchMock.mockImplementation(async (url: string) => (url.includes('/c2/')
        ? reply(503, { code: 'NOT_LEADER', error: 'x' })
        : reply(200, done('r1', 'c1'))))
      const { result } = renderHook(() => useGroupRunPoll(GROUP.slice(0, 2)))
      await act(async () => { await vi.advanceTimersByTimeAsync(600_000) })
      // A verdict of the UI only (the run may still end on the server): told apart from a run that cannot be read.
      expect(result.current[1]).toMatchObject({ fatal: true, abandoned: true, ended: true })
      expect(fetchMock.mock.calls.filter(([u]) => (u as string).includes('/c2/'))).toHaveLength(RUN_READ_MAX_FAILURES)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps reading a single cluster after failed reads, as one run was always read', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      fetchMock.mockImplementation(async () => reply(503, { code: 'NOT_LEADER', error: 'x' }))
      const { result } = renderHook(() => useGroupRunPoll([{ connection_id: 'c1', run_id: 'r1' }]))
      await act(async () => { await vi.advanceTimersByTimeAsync(600_000) })
      expect(fetchMock.mock.calls.length).toBeGreaterThan(RUN_READ_MAX_FAILURES)
      expect(result.current[0].fatal).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
