/**
 * Progress bar of a running disk move on its taskbar row (roadmap#196). The
 * progress hook is replaced so the test reads what the footer hands it (rows
 * and cadence) and what it draws with the answer.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import TasksFooter from './TasksFooter'

const { moveHook } = vi.hoisted(() => ({ moveHook: vi.fn() }))

const MOVE_UPID = 'UPID:pve1:1:2:6A000000:qmmove:101:root@pam:'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'en',
}))
vi.mock('@/contexts/RBACContext', () => ({ useRBAC: () => ({ hasPermission: () => false }) }))
vi.mock('@/contexts/ProxCenterTasksContext', () => ({
  useProxCenterTasks: () => ({ tasks: [], clearDone: vi.fn(), restoreTask: vi.fn() }),
}))
vi.mock('@/hooks/useSharedTasks', () => ({ useSharedTasks: () => ({ data: undefined }) }))
vi.mock('@/hooks/useTaskEvents', () => ({
  useTaskEvents: () => ({
    data: {
      data: [
        { id: MOVE_UPID, type: 'qmmove', typeLabel: 'Move disk', status: 'running', ts: '2026-11-03T08:00:00Z', endTs: null, node: 'pve1', user: 'root@pam', entity: '101', connectionId: 'c1', connectionName: 'PVE 1' },
        { id: 'UPID:b', type: 'vzdump', typeLabel: 'Backup', status: 'running', ts: '2026-11-03T07:00:00Z', endTs: null, node: 'pve2', user: 'root@pam', entity: '102', connectionId: 'c1', connectionName: 'PVE 1' },
      ],
    },
    mutate: vi.fn(),
    isLoading: false,
  }),
}))
vi.mock('@/hooks/useMoveTaskProgress', () => ({ useMoveTaskProgress: (...a: any[]) => moveHook(...a) }))
vi.mock('@/contexts/LicenseContext', () => ({ useLicense: () => ({ isEnterprise: false }) }))
vi.mock('@/hooks/useJobs', () => ({ useJobs: () => ({ data: undefined }) }))
vi.mock('@/hooks/useActiveBulkBatches', () => ({ useActiveBulkBatches: () => ({ data: undefined }) }))
vi.mock('@/hooks/useRefreshInterval', () => ({ useRefreshInterval: (base?: number) => base ?? 30000 }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@mui/x-data-grid', () => ({
  DataGrid: ({ rows, columns }: any) => {
    const status = columns.find((c: any) => c.field === 'status')

    return (
      <ul data-testid='datagrid'>
        {rows.map((r: any) => (
          <li key={r.id} data-testid={`status-${r.id}`}>{status.renderCell({ value: r.status, row: r })}</li>
        ))}
      </ul>
    )
  },
}))
vi.mock('./TaskDetailDialog', () => ({ default: () => null }))
vi.mock('@/components/SharedTaskDetailDialog', () => ({ default: () => null }))
vi.mock('@/components/tasks/JobDetailDialog', () => ({ default: () => null }))

afterEach(() => {
  cleanup()
  moveHook.mockReset()
  window.localStorage.clear()
})

describe('TasksFooter: running move progress (roadmap#196)', () => {
  it('draws the bar on the move row and keeps the chip on the others', () => {
    moveHook.mockReturnValue({ [MOVE_UPID]: { percent: 50, doneBytes: 512, totalBytes: 1024, bytesPerSec: 256, etaSec: 2 } })
    render(<TasksFooter defaultExpanded />)

    expect(screen.getByTestId(`status-${MOVE_UPID}`).querySelector('[role="progressbar"]')).not.toBeNull()
    expect(screen.getByTestId(`status-${MOVE_UPID}`).textContent).toBe('50%')
    expect(screen.getByTestId('status-UPID:b').querySelector('[role="progressbar"]')).toBeNull()
  })

  it('polls the shown rows at the task detail cadence, and nothing while the panel is closed', () => {
    moveHook.mockReturnValue({})
    render(<TasksFooter defaultExpanded />)

    const [rows, interval] = moveHook.mock.calls.at(-1)!
    expect(rows.map((r: any) => r.upid)).toContain(MOVE_UPID)
    expect(interval).toBe(2000)

    fireEvent.click(screen.getByLabelText('tasks.collapse'))
    const [closedRows, closedInterval] = moveHook.mock.calls.at(-1)!
    expect(closedRows).toEqual([])
    expect(closedInterval).toBe(0)
  })
})
