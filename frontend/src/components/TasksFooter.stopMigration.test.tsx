/**
 * Stopping a migration from the task bar asks what its migrate dialog asks: a
 * warm run offers to remove its copy on the target, ticked by default. The
 * bar used to send a bare cancel, which always kept the copy (#612).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

import TasksFooter from './TasksFooter'

const { state } = vi.hoisted(() => ({
  state: { shared: [] as unknown[], jobs: undefined as unknown[] | undefined },
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key),
  useLocale: () => 'en',
}))
vi.mock('@/contexts/ProxCenterTasksContext', () => ({
  useProxCenterTasks: () => ({ tasks: [], clearDone: vi.fn(), restoreTask: () => false, cancelTask: vi.fn() }),
}))
vi.mock('@/contexts/RBACContext', () => ({ useRBAC: () => ({ hasPermission: () => true }) }))
vi.mock('@/hooks/useSharedTasks', () => ({ useSharedTasks: () => ({ data: { data: state.shared }, mutate: vi.fn() }) }))
vi.mock('@/hooks/useTaskEvents', () => ({ useTaskEvents: () => ({ data: { data: [] }, mutate: vi.fn(), isLoading: false }) }))
vi.mock('@/contexts/LicenseContext', () => ({ useLicense: () => ({ isEnterprise: true }) }))
vi.mock('@/hooks/useJobs', () => ({ useJobs: () => ({ data: state.jobs ? { data: state.jobs } : undefined, mutate: vi.fn() }) }))
vi.mock('@/hooks/useActiveBulkBatches', () => ({ useActiveBulkBatches: () => ({ data: undefined }) }))
vi.mock('@/hooks/useRefreshInterval', () => ({ useRefreshInterval: () => 0 }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@mui/x-data-grid', () => ({ DataGrid: () => <div data-testid="datagrid" /> }))
vi.mock('./TaskDetailDialog', () => ({ default: () => null }))
vi.mock('@/components/tasks/JobDetailDialog', () => ({ default: () => null }))

const shared = (over: Record<string, unknown>) => ({
  id: 'job-5', kind: 'migration', label: 'APP01 (vCenter -> Proxmox)', sourceVmName: 'APP01', sourceConnectionId: 'vc1', sourceVmId: 'vm-5',
  batchId: null, targetNode: 'pve1', targetVmid: 118, status: 'delta_sync', currentStep: 'delta_3', progress: 90, totalDisks: null,
  currentDisk: null, bytesTransferred: null, totalBytes: null, transferSpeed: null, error: null, projectedDowntimeSec: 112,
  cutoverMode: 'manual', migrationType: 'warm', convertGuest: null, isMine: true, createdByName: 'me', createdAt: '2026-11-15T10:00:00.000Z',
  startedAt: null, completedAt: null, ...over,
})

const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, json: async () => ({}) }))

beforeEach(() => {
  state.shared = []
  state.jobs = undefined
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const openStop = () => {
  render(<TasksFooter defaultExpanded />)
  fireEvent.click(screen.getByText('ProxCenter'))
  fireEvent.click(screen.getByRole('button', { name: 'tasks.stop.action' }))
}
const confirmStop = () => fireEvent.click(screen.getByRole('button', { name: 'inventoryPage.esxiMigration.cancelMigration' }))
const cancelCall = () => fetchMock.mock.calls.find(c => String(c[0]).endsWith('/cancel'))

describe('TasksFooter stop of a migration', () => {
  it('removes the copy of a warm run on the target unless the operator unticks it', async () => {
    state.shared = [shared({})]
    openStop()

    expect(screen.getByRole('checkbox')).toBeChecked()
    expect(screen.getByText('inventoryPage.esxiMigration.cancelMigrationRemoveTarget:{"vmid":118}')).toBeInTheDocument()
    confirmStop()

    await waitFor(() => expect(cancelCall()).toBeDefined())
    expect(cancelCall()).toEqual(['/api/v1/migrations/job-5/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ removeTarget: true }) }])
  })

  it('keeps the copy when the box is unticked', async () => {
    state.shared = [shared({})]
    openStop()
    fireEvent.click(screen.getByRole('checkbox'))
    confirmStop()

    await waitFor(() => expect(cancelCall()).toBeDefined())
    expect(cancelCall()).toEqual(['/api/v1/migrations/job-5/cancel', { method: 'POST' }])
  })

  it('reads what to offer from the Task Center row when it lists the run', async () => {
    state.shared = [shared({})]
    state.jobs = [{
      id: 'job-5', type: 'migration', name: 'Migration - APP01', status: 'running', progress: 90, createdAt: '2026-11-15T10:00:00.000Z',
      metadata: { cancellable: true, sourceConnectionId: 'vc1', batchId: null, migrationType: 'cold', targetVmid: 120 },
    }]
    openStop()

    // a cold run copies nothing to keep: no choice to make
    expect(screen.queryByRole('checkbox')).toBeNull()
    confirmStop()
    await waitFor(() => expect(cancelCall()).toBeDefined())
    expect(cancelCall()).toEqual(['/api/v1/migrations/job-5/cancel', { method: 'POST' }])
  })
})
