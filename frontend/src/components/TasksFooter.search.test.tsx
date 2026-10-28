/**
 * Taskbar search and archive link (#1225). The grid is replaced by a list of
 * the rows it receives, so the assertions read what the search keeps.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import TasksFooter from './TasksFooter'

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
vi.mock('./TaskDetailDialog', () => ({ default: () => null }))
vi.mock('@/components/SharedTaskDetailDialog', () => ({ default: () => null }))
vi.mock('@/components/tasks/JobDetailDialog', () => ({ default: () => null }))

afterEach(() => {
  cleanup()
  permissions.clear()
  window.localStorage.clear()
})

function gridText() {
  return screen.getByTestId('datagrid').textContent
}

describe('TasksFooter search (#1225)', () => {
  it('filters the rows as the operator types, shows the count and clears on Escape', () => {
    render(<TasksFooter defaultExpanded />)
    const search = screen.getByLabelText('tasks.search')

    fireEvent.change(search, { target: { value: 'WEB' } })
    expect(gridText()).toContain('VM Migrate')
    expect(gridText()).not.toContain('Backup')
    expect(screen.getByText('1 / 2')).toBeTruthy()

    fireEvent.keyDown(search, { key: 'Escape' })
    expect(gridText()).toContain('Backup')
    expect(screen.queryByText('1 / 2')).toBeNull()
  })

  it('clears with the button and opens a collapsed bar when typing', () => {
    render(<TasksFooter />)
    const search = screen.getByLabelText('tasks.search')

    fireEvent.change(search, { target: { value: 'pve2' } })
    expect(gridText()).toContain('Backup')
    expect(gridText()).not.toContain('VM Migrate')

    fireEvent.click(screen.getByLabelText('tasks.clearSearch'))
    expect((search as HTMLInputElement).value).toBe('')
  })

  it('reads the duration like the archive, a dash when unknown', () => {
    render(<TasksFooter defaultExpanded />)

    expect(screen.getByTestId('duration-UPID:a').textContent).toBe('2m 5s')
    expect(screen.getByTestId('duration-UPID:b').textContent).toBe('—')
  })

  it('links to the archive only for a user who may read events', () => {
    render(<TasksFooter defaultExpanded />)
    expect(screen.queryByLabelText('tasks.openArchive')).toBeNull()
    cleanup()

    permissions.add('events.view')
    render(<TasksFooter defaultExpanded />)
    expect(screen.getByLabelText('tasks.openArchive').getAttribute('href')).toBe('/operations/events?view=archive')
  })
})
