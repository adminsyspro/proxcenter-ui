/**
 * Provider tests for stopping a task from its row (#974).
 *
 * A stop has two legs and the tests keep them apart: the browser one (the
 * registered callback that breaks the chunk loop) and the server one (the
 * DELETE that drops the half-written transfer to Proxmox). After a reload only
 * the second is left, which is why the URL travels on the task itself rather
 * than in a callback map, and why a task without a cancelUrl must still land
 * on `cancelled`.
 *
 * fetch is stubbed rather than routed through MSW: the assertions are about
 * the request the provider builds and the status the row ends on, not about a
 * server fixture.
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'

import { ProxCenterTasksProvider, useProxCenterTasks, type PCTask } from './ProxCenterTasksContext'

const CANCEL_URL = '/api/v1/connections/conn-1/nodes/pve1/storage/local/upload'

/** The provider under test, driven through its own hook. */
let ctx!: { current: ReturnType<typeof useProxCenterTasks> }

/** The rows as the taskbar would list them: id and status, newest first. */
const rows = () => ctx.current.tasks.map(t => `${t.id}:${t.status}`).join(',')

function baseTask(overrides: Partial<PCTask> = {}): PCTask {
  return {
    id: 'up-1',
    type: 'upload',
    label: 'debian-13.iso',
    progress: 40,
    status: 'running',
    createdAt: 0,
    ...overrides,
  }
}

function response(body: unknown, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body } as unknown as Response
}

function stubFetch(impl: () => Promise<Response>) {
  const mock = vi.fn(impl)

  vi.stubGlobal('fetch', mock)

  return mock
}

const renderProvider = () => {
  ctx = renderHook(() => useProxCenterTasks(), {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <ProxCenterTasksProvider>{children}</ProxCenterTasksProvider>
    ),
  }).result
}

/**
 * Mount the provider with one task already listed, plus a second one nobody
 * stops: a stop must leave the rows around it alone.
 */
async function withTask(task: PCTask) {
  renderProvider()
  await act(async () => {
    ctx.current.addTask(baseTask({ id: 'other-1', label: 'ubuntu-24.iso' }))
    ctx.current.addTask(task)
  })
}

/** The status the untouched row is expected to keep. */
const OTHER_ROW = 'other-1:running'

/** Call cancelTask and hand back what it answered. */
async function stop(id: string) {
  let outcome: { ok: boolean; error?: string } | undefined

  await act(async () => {
    outcome = await ctx.current.cancelTask(id)
  })

  return outcome
}

beforeEach(() => {
  sessionStorage.clear()
  stubFetch(async () => response({}))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('cancelTask', () => {
  it('stops the browser leg and cancels the row when there is nothing server-side', async () => {
    const abortChunkLoop = vi.fn()

    await withTask(baseTask({ id: 'local-1' }))
    act(() => ctx.current.registerOnCancel('local-1', abortChunkLoop))

    expect(await stop('local-1')).toEqual({ ok: true })
    expect(abortChunkLoop).toHaveBeenCalledTimes(1)
    expect(fetch).not.toHaveBeenCalled()
    expect(rows()).toBe(`local-1:cancelled,${OTHER_ROW}`)
  })

  it('sends the DELETE carrying the task id the server matches on', async () => {
    await withTask(baseTask({ cancelUrl: CANCEL_URL }))

    expect(await stop('up-1')).toEqual({ ok: true })
    expect(fetch).toHaveBeenCalledWith(CANCEL_URL, {
      method: 'DELETE',
      headers: { 'X-Upload-Id': 'up-1' },
    })
    expect(rows()).toBe(`up-1:cancelled,${OTHER_ROW}`)
  })

  it('counts a 404 as stopped, since the transfer had already ended', async () => {
    stubFetch(async () => response({}, { ok: false, status: 404 }))
    await withTask(baseTask({ cancelUrl: CANCEL_URL }))

    expect(await stop('up-1')).toEqual({ ok: true })
    expect(rows()).toBe(`up-1:cancelled,${OTHER_ROW}`)
  })

  it('leaves the row running and surfaces the message when the server refuses', async () => {
    stubFetch(async () => response({ error: 'Upload already finished' }, { ok: false, status: 409 }))
    await withTask(baseTask({ cancelUrl: CANCEL_URL }))

    expect(await stop('up-1')).toEqual({ ok: false, error: 'Upload already finished' })
    expect(rows()).toBe(`up-1:running,${OTHER_ROW}`)
  })

  it('falls back to the HTTP status when the refusal carries no readable body', async () => {
    stubFetch(async () => ({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('not JSON')
      },
    }) as unknown as Response)
    await withTask(baseTask({ cancelUrl: CANCEL_URL }))

    expect(await stop('up-1')).toEqual({ ok: false, error: 'Failed to stop the upload (HTTP 502)' })
    expect(rows()).toBe(`up-1:running,${OTHER_ROW}`)
  })

  it('reports a network failure without cancelling the row', async () => {
    stubFetch(async () => {
      throw new Error('Failed to fetch')
    })
    await withTask(baseTask({ cancelUrl: CANCEL_URL }))

    expect(await stop('up-1')).toEqual({ ok: false, error: 'Failed to fetch' })
    expect(rows()).toBe(`up-1:running,${OTHER_ROW}`)
  })

  it('still reports something when the failure carries no message', async () => {
    stubFetch(async () => {
      throw {}
    })
    await withTask(baseTask({ cancelUrl: CANCEL_URL }))

    expect(await stop('up-1')).toEqual({ ok: false, error: 'Failed to stop the upload' })
  })

  it('drops the browser leg once it is unregistered', async () => {
    const abortChunkLoop = vi.fn()

    await withTask(baseTask({ id: 'local-1' }))
    act(() => {
      ctx.current.registerOnCancel('local-1', abortChunkLoop)
      ctx.current.unregisterOnCancel('local-1')
    })

    expect(await stop('local-1')).toEqual({ ok: true })
    expect(abortChunkLoop).not.toHaveBeenCalled()
    expect(rows()).toBe(`local-1:cancelled,${OTHER_ROW}`)
  })

  it('shrugs off a stop aimed at a row that is no longer listed', async () => {
    await withTask(baseTask({ id: 'local-1' }))

    expect(await stop('ghost-1')).toEqual({ ok: true })
    expect(fetch).not.toHaveBeenCalled()
    expect(rows()).toBe(`local-1:running,${OTHER_ROW}`)
  })

  it('reads the task list as it stands when it is called, not as it was on mount', async () => {
    renderProvider()
    await act(async () => {
      ctx.current.addTask(baseTask({ id: 'late-1', cancelUrl: CANCEL_URL }))
    })

    expect(await stop('late-1')).toEqual({ ok: true })
    expect(fetch).toHaveBeenCalledWith(CANCEL_URL, expect.objectContaining({ method: 'DELETE' }))
  })
})

describe('an upload resumed after a reload', () => {
  it('lands on cancelled when the server reports the transfer was stopped', async () => {
    vi.useFakeTimers()
    sessionStorage.setItem(
      'proxcenter-tasks',
      JSON.stringify([baseTask({ id: 'resumed-1' }), baseTask({ id: 'kept-1', status: 'done', progress: 100 })])
    )

    // Still sending on the first poll, stopped by the second: the row must not
    // be written off before the server says the transfer is actually gone.
    const answers = [
      { status: 'transferring', bytesSent: 50, totalBytes: 100 },
      { status: 'cancelled' },
    ]
    const fetchMock = stubFetch(async () => response(answers.shift() ?? { status: 'cancelled' }))

    renderProvider()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600)
    })
    expect(rows()).toBe('resumed-1:running,kept-1:done')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600)
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/upload-progress/resumed-1')
    expect(rows()).toBe('resumed-1:cancelled,kept-1:done')
  })
})
