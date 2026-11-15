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
  state: {
    restoreTask: (() => false) as (id: string) => boolean,
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
    tasks: [{ id: 'migration-job-9', type: 'generic', label: 'Migrating DHCP01 (vCenter → Proxmox)', detail: 'delta_20', progress: 90, status: 'running', createdAt: 1 }],
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

function clickRow() {
  render(<TasksFooter defaultExpanded />)
  fireEvent.click(screen.getByText('ProxCenter'))
  fireEvent.click(screen.getByText('Migrating DHCP01 (vCenter → Proxmox)'))
}

beforeEach(() => {
  state.pushed = []
  state.shared = []
  state.jobs = undefined
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
  })

  it('reopens the migrate dialog from the run itself when this tab no longer holds it', () => {
    // After a reload, from another page or for a colleague: the Inventory page
    // rebuilds the dialog from the run's record. No reduced detail any more.
    state.restoreTask = () => false
    clickRow()

    expect(state.pushed).toEqual(['/infrastructure/inventory?openMigration=job-9'])
  })

  it('lets a mounted Inventory page reopen it in place', () => {
    state.restoreTask = () => false
    const onOpen = (e: Event) => { (e as CustomEvent<{ handled: boolean }>).detail.handled = true }
    window.addEventListener('proxcenter:open-migration-job', onOpen)
    try {
      clickRow()
    } finally {
      window.removeEventListener('proxcenter:open-migration-job', onOpen)
    }

    expect(state.pushed).toEqual([])
  })
})

describe('TasksFooter shared migration row', () => {
  const shared = (over: Record<string, unknown>) => ({
    id: 'job-5', kind: 'migration', label: 'APP01 (vCenter -> Proxmox)', sourceVmName: 'APP01', sourceConnectionId: 'vc1', sourceVmId: 'vm-5',
    batchId: null, targetNode: 'pve1', targetVmid: null, status: 'full_copy', currentStep: 'full_copy', progress: 30, totalDisks: null,
    currentDisk: null, bytesTransferred: null, totalBytes: null, transferSpeed: null, error: null, projectedDowntimeSec: null,
    cutoverMode: 'auto', convertGuest: null, isMine: false, createdByName: 'Bob', createdAt: '2026-11-14T10:00:00.000Z',
    startedAt: null, completedAt: null, ...over,
  })
  const clickShared = () => {
    render(<TasksFooter defaultExpanded />)
    fireEvent.click(screen.getByText('ProxCenter'))
    fireEvent.click(screen.getByText('APP01 (vCenter -> Proxmox)'))
  }

  it('opens the migrate dialog of a run started elsewhere, on its source host', () => {
    state.restoreTask = () => false
    state.shared = [shared({})]
    clickShared()

    expect(state.pushed).toEqual(['/infrastructure/inventory?selectType=ext&selectId=vc1&openMigration=job-5'])
  })

  it('opens the migrate dialog even when the Task Center lists the same run', () => {
    // Seen at the bench: the Task Center lists migrations under the same id, so
    // the row took the Task Center path (double-click, reduced dialog) and a
    // click opened nothing.
    state.restoreTask = () => false
    state.shared = [shared({})]
    state.jobs = [{ id: 'job-5', type: 'migration', name: 'Migration - APP01', status: 'running', progress: 30, createdAt: '2026-11-14T10:00:00.000Z' }]
    clickShared()

    expect(state.pushed).toEqual(['/infrastructure/inventory?selectType=ext&selectId=vc1&openMigration=job-5'])
  })

  it('opens on its source host a migration only the Task Center lists, a finished one for instance', () => {
    state.restoreTask = () => false
    state.jobs = [{ id: 'job-7', type: 'migration', name: 'Migration - OLD01', status: 'completed', progress: 100, createdAt: '2026-11-14T09:00:00.000Z', metadata: { sourceConnectionId: 'vc2', batchId: null } }]
    render(<TasksFooter defaultExpanded />)
    fireEvent.click(screen.getByText('ProxCenter'))
    fireEvent.click(screen.getByText('Migration - OLD01'))

    expect(state.pushed).toEqual(['/infrastructure/inventory?selectType=ext&selectId=vc2&openMigration=job-7'])
  })

  it('opens the follow-up of its batch for a run of a bulk migration', () => {
    state.restoreTask = () => false
    state.shared = [shared({ batchId: 'b-2' })]
    clickShared()

    expect(state.pushed).toEqual(['/infrastructure/inventory?selectType=ext&selectId=vc1&openBatch=b-2'])
  })
})
