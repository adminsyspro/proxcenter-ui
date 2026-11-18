/**
 * Resuming, when the tab opens, the applications and removals still running on every cluster of the group.
 */

import React, { type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'

import enMessages from '@/messages/en.json'
import { forgetSharedReads } from '@/lib/microseg/api'
import type { MicrosegRun } from '@/lib/microseg/types'

import { useResumeRuns } from './useResumeRuns'

const fetchMock = vi.fn()
const reply = (status: number, body: unknown) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) })
const running = (id: string, connectionId: string, kind = 'apply'): MicrosegRun => ({
  id, policy_id: 'p1', connection_id: connectionId, kind, status: 'running', started_at: '2026-11-02T10:00:00Z', duration_ms: 0, api_calls: 0, writes: 0, result: null, error: '',
})

/** Answers GET /runs of each connection with its list. */
function runsOf(byConnection: Record<string, MicrosegRun[]>) {
  fetchMock.mockImplementation(async (url: string) => {
    const conn = /microseg\/([^/]+)\/runs/.exec(url)?.[1] ?? ''
    return reply(200, { runs: byConnection[conn] ?? [], limit: 100, offset: 0 })
  })
}
const listed = () => fetchMock.mock.calls.map(([u]) => /microseg\/([^/]+)\/runs/.exec(u as string)?.[1])

const wrapper = ({ children }: { children: ReactNode }) => (
  <NextIntlClientProvider locale='en' messages={enMessages as Record<string, unknown>}>{children}</NextIntlClientProvider>
)
const names = (id: string) => ({ c1: 'PVE-PROD', c2: 'PVE-DR' }[id] ?? id)

beforeEach(() => {
  fetchMock.mockReset()
  forgetSharedReads()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('useResumeRuns', () => {
  it('reads the connection alone and resumes its application as before for a policy that is not shared', async () => {
    runsOf({ c1: [running('a1', 'c1')] })
    const startRun = vi.fn()
    renderHook(() => useResumeRuns('c1', 'PVE-PROD', startRun, { ids: ['c1'], loading: false, clusterName: names }), { wrapper })
    await waitFor(() => expect(startRun).toHaveBeenCalledTimes(1))
    expect(startRun).toHaveBeenCalledWith({ runId: 'a1', kind: 'apply', label: 'Apply', runningText: 'Plan apply in progress' })
    expect(listed()).toEqual(['c1'])
  })

  it('finds an application still running on the second cluster and follows it through that cluster', async () => {
    runsOf({ c1: [], c2: [running('a2', 'c2')] })
    const startRun = vi.fn()
    renderHook(() => useResumeRuns('c1', 'PVE-PROD', startRun, { ids: ['c1', 'c2'], loading: false, clusterName: names }), { wrapper })
    await waitFor(() => expect(startRun).toHaveBeenCalledTimes(1))
    expect(startRun).toHaveBeenCalledWith({ runId: 'a2', kind: 'apply', label: 'Apply', runningText: 'Plan apply in progress', runs: [{ connection_id: 'c2', run_id: 'a2' }] })
    expect(new Set(listed())).toEqual(new Set(['c1', 'c2']))
  })

  it('gathers the runs of one application on several clusters on one line, keyed by the run of the opened cluster', async () => {
    runsOf({ c1: [running('a1', 'c1')], c2: [running('a2', 'c2')] })
    const startRun = vi.fn()
    // Opened from the second cluster's URL: the group decides which clusters are read.
    renderHook(() => useResumeRuns('c2', 'PVE-DR', startRun, { ids: ['c1', 'c2'], loading: false, clusterName: names }), { wrapper })
    await waitFor(() => expect(startRun).toHaveBeenCalledTimes(1))
    expect(startRun).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'a2', kind: 'apply', runs: [{ connection_id: 'c1', run_id: 'a1' }, { connection_id: 'c2', run_id: 'a2' }],
    }))
  })

  it('names a removal running on another cluster after that cluster', async () => {
    runsOf({ c1: [], c2: [running('x2', 'c2', 'remove')] })
    const startRun = vi.fn()
    renderHook(() => useResumeRuns('c1', 'PVE-PROD', startRun, { ids: ['c1', 'c2'], loading: false, clusterName: names }), { wrapper })
    await waitFor(() => expect(startRun).toHaveBeenCalledTimes(1))
    expect(startRun).toHaveBeenCalledWith(expect.objectContaining({ runId: 'x2', kind: 'remove', label: 'PVE-DR', runs: [{ connection_id: 'c2', run_id: 'x2' }] }))
  })

  it('reads nothing while the group is still read', async () => {
    runsOf({ c1: [running('a1', 'c1')] })
    const startRun = vi.fn()
    const { rerender } = renderHook(({ loading }) => useResumeRuns('c1', 'PVE-PROD', startRun, { ids: ['c1'], loading, clusterName: names }), { wrapper, initialProps: { loading: true } })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(fetchMock).not.toHaveBeenCalled()
    rerender({ loading: false })
    await waitFor(() => expect(startRun).toHaveBeenCalledTimes(1))
  })

  it('keeps the clusters that answered when one cluster cannot be read', async () => {
    fetchMock.mockImplementation(async (url: string) => (url.includes('/c1/')
      ? reply(503, { code: 'NOT_LEADER', error: 'x' })
      : reply(200, { runs: [running('a2', 'c2')], limit: 100, offset: 0 })))
    const startRun = vi.fn()
    renderHook(() => useResumeRuns('c1', 'PVE-PROD', startRun, { ids: ['c1', 'c2'], loading: false, clusterName: names }), { wrapper })
    await waitFor(() => expect(startRun).toHaveBeenCalledTimes(1))
    expect(startRun).toHaveBeenCalledWith(expect.objectContaining({ runId: 'a2', runs: [{ connection_id: 'c2', run_id: 'a2' }] }))
  })
})
