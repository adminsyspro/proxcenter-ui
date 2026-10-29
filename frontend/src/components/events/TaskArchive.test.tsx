/**
 * Component tests for the task archive of the Events page (#1225). The data
 * hook is mocked: every assertion reads the archive URL the component asks
 * for (the filter contract with the route) or what it renders from a reply.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import TaskArchive from './TaskArchive'

const { swrMock, mutateMock } = vi.hoisted(() => ({ swrMock: vi.fn(), mutateMock: vi.fn() }))

vi.mock('next-intl', () => {
  const t = (key: string, values?: Record<string, unknown>) => (values ? `${key} ${JSON.stringify(values)}` : key)

  t.has = (key: string) => key === 'events.taskTypes.qmigrate'

  return { useTranslations: () => t, useLocale: () => 'en' }
})
vi.mock('@/hooks/useSWRFetch', () => ({ useSWRFetch: (...a: any[]) => swrMock(...a) }))
vi.mock('@/components/charts/DonutStatCards', () => ({
  DonutTotalCard: ({ title, value }: any) => <div data-testid='donut-total'>{`${title}:${value}`}</div>,
  DonutStatCard: ({ title, value }: any) => <div data-testid='donut'>{`${title}:${value}`}</div>,
}))
vi.mock('@/components/events/TaskHistoryRetention', () => ({ default: () => <div data-testid='retention' /> }))
vi.mock('@/components/TaskDetailDialog', () => ({
  default: ({ open, task }: any) => (open ? <div data-testid='task-dialog'>{task.typeLabel}</div> : null),
}))

const NOW = Date.now()

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'UPID:n1:1',
    ts: new Date(NOW - 3600_000).toISOString(),
    endTs: new Date(NOW - 3500_000).toISOString(),
    type: 'qmigrate',
    family: 'migration',
    entity: '101',
    vmid: '101',
    guestName: 'web-01',
    guestType: 'qemu',
    guestStatus: 'running',
    node: 'n1',
    nodeStatus: 'online',
    user: 'root@pam',
    status: 'OK',
    statusClass: 'ok',
    durationSec: 100,
    duration: '1m 40s',
    connectionId: 'c1',
    connectionName: 'PVE 1',
    ...over,
  }
}

const REPLY = {
  data: [
    row({ initiatedBy: { email: 'alice@example.com', apiTokenId: null } }),
    row({ id: 'UPID:n2:2', type: 'aptupdate', family: 'other', entity: null, vmid: null, guestName: null, node: 'n2', status: 'WARNINGS: 1', statusClass: 'warning' }),
    row({ id: 'UPID:n1:3', type: 'vzdump', family: 'backup', status: 'job errors', statusClass: 'error', guestName: null }),
    row({ id: 'UPID:n1:4', type: 'qmstart', family: 'power', status: 'running', statusClass: 'running', endTs: null }),
  ],
  meta: {
    total: 120,
    page: 0,
    pageSize: 50,
    truncated: true,
    summary: { total: 45, ok: 40, warning: 2, error: 2, running: 1 },
    unavailable: [{ connectionName: 'PVE 2', node: 'n9' }, { connectionName: 'PVE 3', node: '' }],
    connections: [{ id: 'c1', name: 'PVE 1' }, { id: 'c2', name: 'PVE 2' }],
    nodes: [{ connectionId: 'c1', node: 'n1', status: 'online' }, { connectionId: 'c2', node: 'n2', status: 'online' }],
  },
}

let reply: any

beforeEach(() => {
  reply = { data: REPLY, error: undefined, isLoading: false, isValidating: false, mutate: mutateMock }
  swrMock.mockImplementation(() => reply)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
})

/** Query of the last archive URL the component asked for, or null when it asked for none. */
function lastQuery(): URLSearchParams | null {
  const url = swrMock.mock.calls.at(-1)?.[0] as string | null

  return url ? new URL(url, 'http://x').searchParams : null
}

function openSelect(label: string) {
  const field = screen.getAllByText(label, { selector: 'label' })[0].parentElement!

  fireEvent.mouseDown(within(field).getByRole('combobox'))

  return screen.getByRole('listbox')
}

describe('TaskArchive', () => {
  it('asks for the last 24 h of every family, first page of 50', () => {
    render(<TaskArchive refreshedAt={0} />)

    const q = lastQuery()!

    expect(Number(q.get('until')) - Number(q.get('since'))).toBe(86400)
    expect(q.get('families')).toBe('power,migration,ha,backup,snapshot,other')
    expect(q.get('status')).toBe('all')
    expect(q.get('pageSize')).toBe('50')
    expect(q.get('page')).toBe('0')
  })

  it('renders the summary, the rows and the warnings of the reply', () => {
    render(<TaskArchive refreshedAt={0} />)

    expect(screen.getByTestId('donut-total')).toHaveTextContent('eventsPage.archive.total:45')
    expect(screen.getByText('events.taskTypes.qmigrate')).toBeInTheDocument()
    expect(screen.getByText('aptupdate')).toBeInTheDocument()
    expect(screen.getByText('eventsPage.archive.nodeLevel')).toBeInTheDocument()
    expect(screen.getByText('alice@example.com (root@pam)')).toBeInTheDocument()
    expect(screen.getAllByText('VM 101').length).toBeGreaterThan(0)
    expect(screen.getByRole('img', { name: 'job errors' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'WARNINGS: 1' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'eventsPage.statusRunning' })).toBeInTheDocument()
    expect(screen.getByText(/eventsPage\.archive\.unavailable/)).toHaveTextContent('n9 (PVE 2), PVE 3')
    expect(screen.getByText(/eventsPage\.archive\.truncated/)).toHaveTextContent('5000')
    expect(screen.getByText(/eventsPage\.archive\.displayedRows/)).toBeInTheDocument()
  })

  it('opens the task log of a row, by click or Enter', () => {
    render(<TaskArchive refreshedAt={0} />)

    fireEvent.click(screen.getByText('events.taskTypes.qmigrate'))
    expect(screen.getByTestId('task-dialog')).toHaveTextContent('events.taskTypes.qmigrate')

    cleanup()
    render(<TaskArchive refreshedAt={0} />)
    fireEvent.keyDown(screen.getByText('aptupdate').closest('[role=button]')!, { key: 'Enter' })
    expect(screen.getByTestId('task-dialog')).toHaveTextContent('aptupdate')
  })

  it('sends the status, cluster and node filters', () => {
    render(<TaskArchive refreshedAt={0} />)

    fireEvent.click(within(openSelect('eventsPage.archive.status')).getByText('eventsPage.archive.statusError'))
    expect(lastQuery()!.get('status')).toBe('error')

    fireEvent.click(within(openSelect('eventsPage.archive.cluster')).getByText('PVE 2'))
    expect(lastQuery()!.get('connectionId')).toBe('c2')

    const nodes = openSelect('eventsPage.archive.node')

    expect(within(nodes).queryByText('n1')).toBeNull()
    fireEvent.click(within(nodes).getByText('n2'))
    expect(lastQuery()!.get('node')).toBe('n2')
  })

  it('picks task types from the selector, All toggling every type', () => {
    render(<TaskArchive refreshedAt={0} />)

    fireEvent.click(within(openSelect('eventsPage.archive.families')).getByText('eventsPage.archive.familyAll'))
    expect(lastQuery()).toBeNull()
    expect(screen.getByText('eventsPage.archive.noMatch')).toBeInTheDocument()

    fireEvent.click(within(screen.getByRole('listbox')).getByText('eventsPage.archive.familyMigration'))
    expect(lastQuery()!.get('families')).toBe('migration')

    fireEvent.click(within(screen.getByRole('listbox')).getByText('eventsPage.archive.familyHa'))
    expect(lastQuery()!.get('families')).toBe('migration,ha')
    expect(screen.getByText(/eventsPage\.archive\.familiesCount/)).toHaveTextContent('"count":2')

    fireEvent.click(within(screen.getByRole('listbox')).getByText('eventsPage.archive.familyAll'))
    expect(lastQuery()!.get('families')).toBe('power,migration,ha,backup,snapshot,other')
  })

  it('reads a custom window and asks nothing while it is inverted', () => {
    render(<TaskArchive refreshedAt={0} />)

    fireEvent.click(within(openSelect('eventsPage.archive.period')).getByText('eventsPage.archive.periodCustom'))
    fireEvent.change(screen.getByLabelText('eventsPage.archive.from'), { target: { value: '2026-10-01T08:00' } })
    fireEvent.change(screen.getByLabelText('eventsPage.archive.to'), { target: { value: '2026-10-02T08:00' } })

    const q = lastQuery()!

    expect(Number(q.get('until')) - Number(q.get('since'))).toBe(86400)

    fireEvent.change(screen.getByLabelText('eventsPage.archive.to'), { target: { value: '2026-09-01T08:00' } })
    expect(lastQuery()).toBeNull()
  })

  it('keeps digits only in the VM ID and sends it with the search once typing stops', async () => {
    render(<TaskArchive refreshedAt={0} />)

    fireEvent.change(screen.getByLabelText('eventsPage.archive.vmid'), { target: { value: '1a0b1' } })
    fireEvent.change(screen.getByLabelText('eventsPage.archive.search'), { target: { value: ' backup ' } })
    expect(screen.getByLabelText('eventsPage.archive.vmid')).toHaveValue('101')

    await waitFor(() => {
      expect(lastQuery()!.get('vmid')).toBe('101')
      expect(lastQuery()!.get('q')).toBe('backup')
    })
  })

  it('pages, and goes back to the first page when a filter changes', () => {
    render(<TaskArchive refreshedAt={0} />)

    fireEvent.click(screen.getByRole('button', { name: /next page/i }))
    expect(lastQuery()!.get('page')).toBe('1')

    fireEvent.click(within(openSelect('eventsPage.archive.status')).getByText('eventsPage.archive.statusOk'))
    expect(lastQuery()!.get('page')).toBe('0')
  })

  it('re-anchors a sliding period on refresh and refetches a custom one', () => {
    const { rerender } = render(<TaskArchive refreshedAt={0} />)
    const before = Number(lastQuery()!.get('until'))
    const later = NOW + 120_000

    rerender(<TaskArchive refreshedAt={later} />)
    expect(Number(lastQuery()!.get('until'))).toBe(Math.floor(later / 1000))
    expect(Number(lastQuery()!.get('until'))).toBeGreaterThan(before)
    expect(mutateMock).not.toHaveBeenCalled()

    fireEvent.click(within(openSelect('eventsPage.archive.period')).getByText('eventsPage.archive.periodCustom'))
    act(() => rerender(<TaskArchive refreshedAt={later + 1000} />))
    expect(mutateMock).toHaveBeenCalled()
  })

  it('shows loading, error and empty states', () => {
    reply = { data: undefined, error: undefined, isLoading: true, isValidating: true, mutate: mutateMock }
    const { rerender } = render(<TaskArchive refreshedAt={0} />)

    expect(screen.queryByText('eventsPage.archive.noMatch')).toBeNull()

    reply = { data: undefined, error: new Error('boom'), isLoading: false, isValidating: false, mutate: mutateMock }
    rerender(<TaskArchive refreshedAt={0} />)
    expect(screen.getByText(/boom/)).toBeInTheDocument()

    reply = { data: { data: [], meta: { ...REPLY.meta, total: 0, truncated: false, unavailable: [], connections: [] } }, isLoading: false, isValidating: false, mutate: mutateMock }
    rerender(<TaskArchive refreshedAt={0} />)
    expect(screen.getByText('eventsPage.archive.noMatch')).toBeInTheDocument()
    expect(screen.queryByText('eventsPage.archive.cluster')).toBeNull()
    expect(screen.queryByText(/eventsPage\.archive\.displayedRows/)).toBeNull()
  })

  it('marks the rows only ProxCenter\'s copy holds and says the copy covers the missing nodes', () => {
    reply = {
      ...reply,
      data: {
        data: [row({ id: 'UPID:n9:9', node: 'n9', fromHistory: true }), row()],
        meta: { ...REPLY.meta, history: true }
      }
    }
    render(<TaskArchive refreshedAt={0} />)

    expect(screen.getAllByRole('img', { name: 'eventsPage.archive.fromHistory' })).toHaveLength(1)
    expect(screen.getByText(/eventsPage\.archive\.unavailableHistory/)).toHaveTextContent('n9 (PVE 2), PVE 3')
    expect(screen.queryByText(/eventsPage\.archive\.unavailable /)).toBeNull()
    expect(screen.getByTestId('retention')).toBeInTheDocument()
  })
})

