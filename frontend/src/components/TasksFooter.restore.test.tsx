/**
 * Clicking a local migration row of the ProxCenter tab. On the inventory page
 * the migrate dialog reopens itself; anywhere else nothing is mounted to do
 * that, and the row used to stay inert, leaving a manual-cutover run with no
 * way to its "Cutover now" from the taskbar.
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

import TasksFooter from './TasksFooter'

const { state } = vi.hoisted(() => ({
  state: { restoreTask: (() => false) as (id: string) => boolean, sharedJobId: null as string | null },
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'en',
}))

vi.mock('@/contexts/ProxCenterTasksContext', () => ({
  useProxCenterTasks: () => ({
    tasks: [{ id: 'migration-job-9', type: 'generic', label: 'Migrating DHCP01 (vCenter → Proxmox)', detail: 'delta_20', progress: 90, status: 'running', createdAt: 1 }],
    clearDone: vi.fn(),
    restoreTask: (id: string) => state.restoreTask(id),
  }),
}))

vi.mock('@/hooks/useSharedTasks', () => ({ useSharedTasks: () => ({ data: undefined }) }))
vi.mock('@/hooks/useTaskEvents', () => ({
  useTaskEvents: () => ({ data: { data: [] }, mutate: vi.fn(), isLoading: false }),
}))
vi.mock('@/contexts/LicenseContext', () => ({ useLicense: () => ({ isEnterprise: true }) }))
vi.mock('@/hooks/useJobs', () => ({ useJobs: () => ({ data: undefined }) }))
vi.mock('@/hooks/useRefreshInterval', () => ({ useRefreshInterval: () => 0 }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@mui/x-data-grid', () => ({ DataGrid: () => <div data-testid="datagrid" /> }))
vi.mock('./TaskDetailDialog', () => ({ default: () => null }))
// The bulk batch tabs poll through SWR: left real, a revalidation lands after
// jsdom is torn down and fails the run with "document is not defined".
vi.mock('@/hooks/useActiveBulkBatches', () => ({ useActiveBulkBatches: () => ({ data: undefined }) }))
vi.mock('@/components/tasks/JobDetailDialog', () => ({ default: () => null }))
// Record which job the shared detail dialog was opened on.
vi.mock('@/components/SharedTaskDetailDialog', () => ({
  default: ({ jobId }: { jobId: string | null }) => {
    state.sharedJobId = jobId

    return null
  },
}))

function clickRow() {
  render(<TasksFooter defaultExpanded />)
  fireEvent.click(screen.getByText('ProxCenter'))
  fireEvent.click(screen.getByText('Migrating DHCP01 (vCenter → Proxmox)'))
}

beforeEach(() => {
  state.sharedJobId = null
})

afterEach(() => {
  cleanup()
})

describe('TasksFooter local migration row', () => {
  it('lets the migrate dialog reopen itself when it is mounted', () => {
    const restore = vi.fn(() => true)
    state.restoreTask = restore
    clickRow()

    expect(restore).toHaveBeenCalledWith('migration-job-9')
    expect(state.sharedJobId).toBeNull()
  })

  it('opens the job detail when nothing could reopen the dialog', () => {
    state.restoreTask = () => false
    clickRow()

    expect(state.sharedJobId).toBe('job-9')
  })
})
