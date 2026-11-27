/**
 * roadmap#278: without reports.manage the reports UI is read-only. The
 * history keeps its downloads, the schedules list keeps its rows, and every
 * write control (new schedule, run, edit, delete, enable switch) is gone.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, within } from '@/__tests__/setup/renderWithProviders'

vi.mock('@mui/x-data-grid', () => ({
  DataGrid: ({ rows, columns }: any) => (
    <div>
      {rows.map((row: any) => (
        <div key={row.id} data-testid={`row-${row.id}`}>
          {columns.map((c: any) => (
            <span key={c.field}>{c.renderCell ? c.renderCell({ row, value: row[c.field], id: row.id }) : String(row[c.field] ?? '')}</span>
          ))}
        </div>
      ))}
    </div>
  ),
}))

import ReportHistory from './ReportHistory'
import ScheduleManager from './ScheduleManager'
import { visibleReportsTab } from '../reportsTabs'

afterEach(() => cleanup())

const SCHEDULE = {
  id: 's1', name: 'Weekly inventory', enabled: true, type: 'inventory', frequency: 'weekly', day_of_week: 1,
  time_of_day: '06:00', connection_ids: [], sections: [], recipients: ['ops@example.com'], language: 'en', created_at: '2026-11-01T00:00:00Z',
}
const REPORT = {
  id: 'r1', type: 'inventory', name: 'Inventory', status: 'completed', date_from: '2026-11-01T00:00:00Z', date_to: '2026-11-02T00:00:00Z',
  connection_ids: [], sections: [], language: 'en', file_size: 1024, created_at: '2026-11-02T00:00:00Z', completed_at: '2026-11-02T00:01:00Z',
}
const noop = vi.fn(async () => {})

function schedules(canManage?: boolean) {
  return renderWithProviders(
    <ScheduleManager schedules={[SCHEDULE] as any} reportTypes={[]} languages={[]} onCreate={noop} onUpdate={noop}
      onDelete={noop} onRunNow={noop} loading={false} {...(canManage === undefined ? {} : { canManage })} />,
  )
}

describe('ScheduleManager', () => {
  it('is read-only without reports.manage', () => {
    schedules(false)
    const row = within(screen.getByTestId('row-s1'))
    expect(row.getByText('Weekly inventory')).toBeInTheDocument()
    expect(row.getByRole('switch')).toBeDisabled()
    expect(row.queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /new schedule/i })).not.toBeInTheDocument()
  })

  it('keeps every write control by default', () => {
    schedules()
    const row = within(screen.getByTestId('row-s1'))
    expect(row.getByRole('switch')).toBeEnabled()
    expect(row.getAllByRole('button')).toHaveLength(3)
    expect(screen.getByRole('button', { name: /new schedule/i })).toBeInTheDocument()
  })

  it('offers no creation from the empty state without reports.manage', () => {
    renderWithProviders(
      <ScheduleManager schedules={[]} reportTypes={[]} languages={[]} onCreate={noop} onUpdate={noop}
        onDelete={noop} onRunNow={noop} loading={false} canManage={false} />,
    )
    expect(screen.queryByRole('button', { name: /new schedule/i })).not.toBeInTheDocument()
  })
})

describe('ReportHistory', () => {
  const history = (canManage?: boolean) => renderWithProviders(
    <ReportHistory reports={[REPORT] as any} reportTypes={[]} onDelete={noop} onRefresh={() => {}} loading={false}
      {...(canManage === undefined ? {} : { canManage })} />,
  )

  it('keeps the download and drops the delete without reports.manage', () => {
    history(false)
    const row = within(screen.getByTestId('row-r1'))
    expect(row.getAllByRole('button').length).toBeGreaterThan(0)
    expect(row.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument()
  })

  it('offers the delete by default', () => {
    history()
    expect(within(screen.getByTestId('row-r1')).getByRole('button', { name: /delete/i })).toBeInTheDocument()
  })
})

describe('visibleReportsTab', () => {
  it('sends a read-only caller from the generator to the history', () => {
    expect(visibleReportsTab('generate', { canManage: false, canCustomize: false })).toBe('history')
    expect(visibleReportsTab('generate', { canManage: true, canCustomize: false })).toBe('generate')
  })

  it('hides the customization tab without admin.settings', () => {
    expect(visibleReportsTab('customization', { canManage: true, canCustomize: false })).toBe('history')
    expect(visibleReportsTab('customization', { canManage: false, canCustomize: true })).toBe('customization')
    expect(visibleReportsTab('schedules', { canManage: false, canCustomize: false })).toBe('schedules')
  })
})
