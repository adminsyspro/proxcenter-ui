/**
 * A dialog that starts a Proxmox task asks the taskbar for its viewer (#1392).
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'

import TasksFooter from './TasksFooter'
import { openTaskViewer } from '@/lib/tasks/taskViewer'

const { permissions } = vi.hoisted(() => ({ permissions: new Set<string>() }))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'en',
}))
vi.mock('@/contexts/RBACContext', () => ({ useRBAC: () => ({ hasPermission: (p: string) => permissions.has(p) }) }))
vi.mock('@/contexts/ProxCenterTasksContext', () => ({
  useProxCenterTasks: () => ({ tasks: [], clearDone: vi.fn(), restoreTask: vi.fn() }),
}))
vi.mock('@/hooks/useSharedTasks', () => ({ useSharedTasks: () => ({ data: undefined }) }))
vi.mock('@/hooks/useTaskEvents', () => ({
  useTaskEvents: () => ({
    data: {
      data: [
        { id: 'UPID:a', type: 'qmigrate', typeLabel: 'VM Migrate', status: 'OK', ts: '2026-10-28T08:00:00Z', endTs: '2026-10-28T08:02:05Z', duration: '2m 5s', durationSec: 125, node: 'pve1', user: 'root@pam', entity: '101', entityName: 'web-01', connectionId: 'c1', connectionName: 'PVE 1' },
        { id: 'UPID:b', type: 'vzdump', typeLabel: 'Backup', status: 'OK', ts: '2026-10-28T07:00:00Z', endTs: null, duration: '', node: 'pve2', user: 'root@pam', entity: '102', entityName: 'db-01', connectionId: 'c1', connectionName: 'PVE 1' },
      ],
    },
    mutate: vi.fn(),
    isLoading: false,
  }),
}))
vi.mock('@/contexts/LicenseContext', () => ({ useLicense: () => ({ isEnterprise: true }) }))
vi.mock('@/hooks/useJobs', () => ({ useJobs: () => ({ data: undefined }) }))
vi.mock('@/hooks/useActiveBulkBatches', () => ({ useActiveBulkBatches: () => ({ data: undefined }) }))
vi.mock('@/hooks/useRefreshInterval', () => ({ useRefreshInterval: () => 0 }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@mui/x-data-grid', () => ({
  DataGrid: ({ rows, columns }: any) => {
    const duration = columns.find((c: any) => c.field === 'durationSec')

    return (
      <ul data-testid='datagrid'>
        {rows.map((r: any) => (
          <li key={r.id}>
            {r.description}
            <span data-testid={`duration-${r.id}`}>{duration.renderCell({ value: r.durationSec, row: r })}</span>
          </li>
        ))}
      </ul>
    )
  },
}))
vi.mock('./TaskDetailDialog', () => ({
  default: ({ open, task }: any) => (open ? <div data-testid='task-viewer'>{JSON.stringify(task)}</div> : null),
}))
vi.mock('@/components/tasks/JobDetailDialog', () => ({ default: () => null }))

afterEach(() => {
  cleanup()
  permissions.clear()
})

const UPID = 'UPID:pve3:0007AF11:06604734:6AFD3A3C:qmigrate:116:root@pam!root:'

describe('TasksFooter - task viewer opened on request', () => {
  it('shows the announced task as running, titled as the caller described it', () => {
    render(<TasksFooter />)
    expect(screen.queryByTestId('task-viewer')).not.toBeInTheDocument()

    act(() => { openTaskViewer({ upid: UPID, connectionId: 'c1', description: 'r9: Migrate' }) })

    expect(JSON.parse(screen.getByTestId('task-viewer').textContent || '{}')).toMatchObject({
      id: UPID,
      status: 'running',
      node: 'pve3',
      type: 'qmigrate',
      typeLabel: 'r9: Migrate',
      connectionId: 'c1',
    })
  })

  it('ignores a request that carries no task', () => {
    render(<TasksFooter />)

    act(() => { openTaskViewer({ upid: null, connectionId: 'c1' }) })

    expect(screen.queryByTestId('task-viewer')).not.toBeInTheDocument()
  })
})
