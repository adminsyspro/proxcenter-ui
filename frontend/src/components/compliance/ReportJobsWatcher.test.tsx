/**
 * The watcher follows the background compliance reports of the taskbar and
 * announces each end once: a success toast with a Download button, or an
 * error toast. It polls only while a report runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'

const { state } = vi.hoisted(() => ({
  state: {
    tasks: [] as any[],
    updateTask: vi.fn(),
    showToast: vi.fn(),
    error: vi.fn(),
    downloads: [] as string[],
  },
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (k: string, v?: Record<string, unknown>) => (v ? `${k}:${JSON.stringify(v)}` : k),
}))
vi.mock('@/contexts/ProxCenterTasksContext', () => ({
  useProxCenterTasks: () => ({ tasks: state.tasks, updateTask: state.updateTask }),
}))
vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ showToast: state.showToast, error: state.error }),
}))
vi.mock('@/components/compliance/frameworksTab.helpers', () => ({
  triggerUrlDownload: (url: string) => state.downloads.push(url),
}))

import ReportJobsWatcher, { REPORT_JOB_POLL_MS } from './ReportJobsWatcher'

const STATUS_URL = '/api/v1/compliance/report-jobs/j1'
const running = { id: 'report-j1', type: 'report', label: 'CMMC report', status: 'running', progress: 0, createdAt: 1, statusUrl: STATUS_URL, downloadUrl: `${STATUS_URL}/download` }

const fetchMock = vi.fn()
const reply = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status })

async function tick() {
  await act(async () => { await vi.advanceTimersByTimeAsync(REPORT_JOB_POLL_MS) })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  state.tasks = [running]
  state.updateTask.mockReset()
  state.showToast.mockReset()
  state.error.mockReset()
  state.downloads = []
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('ReportJobsWatcher', () => {
  it('keeps polling while the report runs, then announces it with a download button', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { data: { status: 'running' } }))
    fetchMock.mockResolvedValueOnce(reply(200, { data: { status: 'done' } }))
    render(<ReportJobsWatcher />)

    await tick()
    expect(fetchMock).toHaveBeenCalledWith(STATUS_URL, { cache: 'no-store' })
    expect(state.updateTask).not.toHaveBeenCalled()

    await tick()
    expect(state.updateTask).toHaveBeenCalledWith('report-j1', { status: 'done', progress: 100, finishedAt: expect.any(Number) })
    const [message, severity, duration, action] = state.showToast.mock.calls[0]
    expect(message).toBe('reportReady:{"report":"CMMC report"}')
    expect(severity).toBe('success')
    expect(duration).toBe(20_000)
    action.onClick()
    expect(state.downloads).toEqual([`${STATUS_URL}/download`])
    // Downloaded from the toast: the bell has nothing left to offer for it.
    expect(state.updateTask).toHaveBeenLastCalledWith('report-j1', { dismissed: true })
  })

  it('reports a failed report as an error', async () => {
    fetchMock.mockResolvedValue(reply(200, { data: { status: 'error', error: 'PDF generation failed' } }))
    render(<ReportJobsWatcher />)

    await tick()

    expect(state.updateTask).toHaveBeenCalledWith('report-j1', { status: 'error', error: 'PDF generation failed', finishedAt: expect.any(Number) })
    expect(state.error).toHaveBeenCalledWith('CMMC report: PDF generation failed', 8000)
  })

  it('reads a vanished report (expired, restarted server) as expired', async () => {
    fetchMock.mockResolvedValue(reply(404))
    render(<ReportJobsWatcher />)

    await tick()

    expect(state.updateTask).toHaveBeenCalledWith('report-j1', { status: 'error', error: 'reportExpired', finishedAt: expect.any(Number) })
  })

  it('tries again after a network blip or a server error', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    fetchMock.mockResolvedValueOnce(reply(502))
    fetchMock.mockResolvedValueOnce(reply(200, {}))
    render(<ReportJobsWatcher />)

    await tick()
    await tick()
    await tick()

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(state.updateTask).not.toHaveBeenCalled()
  })

  it('does not poll when no report runs', async () => {
    state.tasks = [{ ...running, status: 'done' }, { id: 'up-1', type: 'upload', status: 'running', label: 'x', progress: 0, createdAt: 1 }]
    render(<ReportJobsWatcher />)

    await tick()

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
