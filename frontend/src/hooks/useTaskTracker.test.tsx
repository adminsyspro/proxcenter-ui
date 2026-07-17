/**
 * Tests for useTaskTracker.
 *
 * The hook polls /api/v1/tasks/:conn/:node/:upid on a 2s interval until the
 * Proxmox task stops, then fires a toast for the outcome. We drive each branch
 * with a mocked fetch + fake timers and assert the toast call and callbacks.
 *
 * next-intl is mocked to echo the key, so we assert on the translation key the
 * hook chose (taskTracker.completed / .failed / .timeout / .error) rather than
 * a rendered string.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

import { useTaskTracker } from './useTaskTracker'

const { toast } = vi.hoisted(() => ({
  toast: {
    showToast: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => toast,
}))

const POLL_INTERVAL = 2000
const MAX_ATTEMPTS = 150

type TaskInfo = Parameters<ReturnType<typeof useTaskTracker>['trackTask']>[0]

/** Resolve fetch with a JSON body and ok=true. */
function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response
}

function stubFetch(impl: () => Promise<Response>) {
  const mock = vi.fn(impl)
  vi.stubGlobal('fetch', mock)
  return mock
}

function baseTask(overrides: Partial<TaskInfo> = {}): TaskInfo {
  return {
    upid: 'UPID:pve1:0001',
    connId: 'conn-1',
    node: 'pve1',
    description: 'Démarrage de la VM',
    ...overrides,
  }
}

/** Render the hook, start tracking, and advance timers to run the poll(s). */
async function trackAndRun(task: TaskInfo, advanceMs = POLL_INTERVAL) {
  const { result } = renderHook(() => useTaskTracker())
  await act(async () => {
    await result.current.trackTask(task)
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(advanceMs)
  })
  return result
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('useTaskTracker', () => {
  it('fires the initial info toast and a success toast when the task exits OK', async () => {
    stubFetch(async () => okResponse({ status: 'stopped', exitstatus: 'OK' }))
    const onSuccess = vi.fn()

    await trackAndRun(baseTask({ onSuccess }))

    expect(toast.info).toHaveBeenCalledWith('Démarrage de la VM...')
    expect(toast.success).toHaveBeenCalledWith('taskTracker.completed')
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })

  it('reports the exitstatus on failure', async () => {
    stubFetch(async () => okResponse({ status: 'stopped', exitstatus: 'disk full' }))
    const onError = vi.fn()

    await trackAndRun(baseTask({ onError }))

    expect(toast.error).toHaveBeenCalledWith('taskTracker.failed')
    expect(onError).toHaveBeenCalledWith('disk full')
  })

  it('falls back to the unknown-error label when exitstatus is missing', async () => {
    stubFetch(async () => okResponse({ status: 'stopped' }))
    const onError = vi.fn()

    await trackAndRun(baseTask({ onError }))

    expect(toast.error).toHaveBeenCalledWith('taskTracker.failed')
    expect(onError).toHaveBeenCalledWith('taskTracker.unknownError')
  })

  it('warns on timeout after the maximum number of attempts', async () => {
    stubFetch(async () => okResponse({ status: 'running' }))

    // Drive every poll attempt plus the initial scheduling delay.
    await trackAndRun(baseTask(), POLL_INTERVAL * (MAX_ATTEMPTS + 1))

    expect(toast.warning).toHaveBeenCalledWith('taskTracker.timeout')
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('reports the error when polling throws', async () => {
    stubFetch(async () => ({ ok: false, status: 500 }) as unknown as Response)
    const onError = vi.fn()

    await trackAndRun(baseTask({ onError }))

    expect(toast.error).toHaveBeenCalledWith('taskTracker.error')
    expect(onError).toHaveBeenCalledWith('Failed to get task status: 500')
  })

  it('appends query params to the poll URL when provided', async () => {
    const fetchMock = stubFetch(async () => okResponse({ status: 'stopped', exitstatus: 'OK' }))

    await trackAndRun(baseTask({ queryParams: { store: 'local' } }))

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('?store=local'))
  })

  it('ignores a second track request for the same task', async () => {
    const fetchMock = stubFetch(async () => okResponse({ status: 'stopped', exitstatus: 'OK' }))

    const { result } = renderHook(() => useTaskTracker())
    await act(async () => {
      await result.current.trackTask(baseTask())
      await result.current.trackTask(baseTask())
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL)
    })

    // The dedup guard means only the first call schedules a poll.
    expect(toast.info).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
