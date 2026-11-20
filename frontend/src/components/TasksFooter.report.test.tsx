/**
 * A background compliance report in the ProxCenter tab: a PDF icon, and once
 * the report is ready a download button on the row (and the row itself
 * downloads on click). While it runs, nothing to download.
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

import TasksFooter from './TasksFooter'

const { state } = vi.hoisted(() => ({
  state: {
    restoreTask: (() => false) as (id: string) => boolean,
    tasks: [] as unknown[],
    downloads: [] as string[],
    updates: [] as unknown[],
    pushed: [] as string[],
    shared: [] as unknown[],
    jobs: undefined as unknown[] | undefined,
  },
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'en',
}))

vi.mock('@/contexts/ProxCenterTasksContext', () => ({
  useProxCenterTasks: () => ({
    tasks: state.tasks,
    updateTask: (id: string, u: unknown) => state.updates.push([id, u]),
    clearDone: vi.fn(),
    restoreTask: (id: string) => state.restoreTask(id),
  }),
}))

vi.mock('@/hooks/useSharedTasks', () => ({ useSharedTasks: () => ({ data: { data: state.shared }, mutate: vi.fn() }) }))
vi.mock('@/hooks/useTaskEvents', () => ({
  useTaskEvents: () => ({ data: { data: [] }, mutate: vi.fn(), isLoading: false }),
}))
vi.mock('@/contexts/LicenseContext', () => ({ useLicense: () => ({ isEnterprise: true }) }))
vi.mock('@/hooks/useJobs', () => ({ useJobs: () => ({ data: state.jobs ? { data: state.jobs } : undefined, mutate: vi.fn() }) }))
// The bulk migration chips poll over SWR; left real, their revalidation fires
// after the jsdom teardown and fails the run with an unhandled rejection.
vi.mock('@/hooks/useActiveBulkBatches', () => ({ useActiveBulkBatches: () => ({ data: undefined }) }))
vi.mock('@/hooks/useRefreshInterval', () => ({ useRefreshInterval: () => 0 }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: (url: string) => state.pushed.push(url) }) }))
vi.mock('@mui/x-data-grid', () => ({ DataGrid: () => <div data-testid="datagrid" /> }))
vi.mock('./TaskDetailDialog', () => ({ default: () => null }))
// The bulk batch tabs poll through SWR: left real, a revalidation lands after
// jsdom is torn down and fails the run with "document is not defined".
vi.mock('@/hooks/useActiveBulkBatches', () => ({ useActiveBulkBatches: () => ({ data: undefined }) }))
vi.mock('@/components/tasks/JobDetailDialog', () => ({ default: () => null }))
vi.mock('@/components/compliance/frameworksTab.helpers', () => ({ triggerUrlDownload: (url: string) => state.downloads.push(url) }))

const DOWNLOAD_URL = '/api/v1/compliance/report-jobs/j1/download'

function report(status: 'running' | 'done' | 'error') {
  return {
    id: 'report-j1',
    type: 'report',
    label: 'CMMC report',
    detail: 'PVE-PROD',
    progress: status === 'done' ? 100 : 0,
    status,
    createdAt: 1,
    statusUrl: '/api/v1/compliance/report-jobs/j1',
    downloadUrl: DOWNLOAD_URL,
  }
}

function open(status: 'running' | 'done' | 'error') {
  state.tasks = [report(status)]
  const view = render(<TasksFooter defaultExpanded />)
  fireEvent.click(screen.getByText('ProxCenter'))
  return view
}

beforeEach(() => {
  state.pushed = []
  state.shared = []
  state.jobs = undefined
  state.downloads = []
  state.updates = []
})

afterEach(() => {
  cleanup()
})

describe('TasksFooter background report row', () => {
  it('shows a PDF icon and a download button once the report is ready', () => {
    const { container } = open('done')

    expect(container.querySelector('.ri-file-pdf-2-line')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'compliance.frameworks.reportDownload' }))

    expect(state.downloads).toEqual([DOWNLOAD_URL])
    // ...and the bell has nothing left to offer for it.
    expect(state.updates).toEqual([['report-j1', { dismissed: true }]])
  })

  it('downloads from a click on the row itself', () => {
    open('done')

    fireEvent.click(screen.getByText('CMMC report'))

    expect(state.downloads).toEqual([DOWNLOAD_URL])
  })

  it('offers nothing to download while the report runs or after it failed', () => {
    open('running')
    expect(screen.queryByRole('button', { name: 'compliance.frameworks.reportDownload' })).toBeNull()
    fireEvent.click(screen.getByText('CMMC report'))
    cleanup()

    open('error')
    expect(screen.queryByRole('button', { name: 'compliance.frameworks.reportDownload' })).toBeNull()
    expect(state.downloads).toEqual([])
  })
})
