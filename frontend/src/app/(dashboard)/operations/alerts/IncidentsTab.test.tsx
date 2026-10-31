import { cleanup, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders, screen, userEvent } from '@/__tests__/setup/renderWithProviders'
import { makeIncident } from '@/components/incidents/fixtures'

import { AlertMessageCell, AlertsTabs, IncidentButtons, IncidentCell, isAlertInIncidentResponse, summarizeDeletes } from './AlertIncidentParts'
import IncidentsTab from './IncidentsTab'

const { listMock } = vi.hoisted(() => ({ listMock: vi.fn() }))

vi.mock('./useIncidentList', () => ({
  INCIDENT_PAGE_SIZE: 20,
  useIncidentList: (status: string, page: number) => listMock(status, page),
}))

const list = (incidents: ReturnType<typeof makeIncident>[], total = incidents.length) => ({
  data: { incidents, total },
  error: undefined,
  isLoading: false,
})

beforeEach(() => {
  listMock.mockReset().mockImplementation(() => list([
    makeIncident({ id: 'i1', title: 'Node pve1 down', alert_count: 2, comment_count: 3 }),
    makeIncident({ id: 'i2', title: 'Disk full', status: 'resolved', root_cause: 'Logs', ended_at: '2026-10-27T11:00:00.000Z' }),
    makeIncident({ id: 'i3', title: 'Old outage', status: 'closed', postmortem_at: '2026-10-27T12:00:00.000Z' }),
    makeIncident({ id: 'i4', title: 'No cause yet', status: 'resolved', ended_at: '2026-10-27T11:00:00.000Z' }),
  ]))
})

afterEach(() => cleanup())

describe('IncidentsTab', () => {
  it('renders the columns and the post-mortem state of each status', () => {
    renderWithProviders(<IncidentsTab onOpen={vi.fn()} />)

    for (const c of ['Status', 'Title', 'Severity', 'Start', 'Duration', 'Alerts', 'Comments', 'Post-mortem', 'Actions']) {
      expect(screen.getByRole('columnheader', { name: c })).toBeInTheDocument()
    }

    expect(screen.getByText('Node pve1 down')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    // open -> to do, resolved with cause -> in progress, closed -> validated, resolved without cause -> to do
    expect(screen.getAllByText('To do')).toHaveLength(2)
    expect(screen.getAllByText('In progress')).toHaveLength(1)
    expect(screen.getAllByText('Validated')).toHaveLength(1)
  })

  it('shows the empty state', () => {
    listMock.mockImplementation(() => list([]))

    renderWithProviders(<IncidentsTab onOpen={vi.fn()} />)

    expect(screen.getByText('No incident')).toBeInTheDocument()
  })

  it('applies the status filter to the request and goes back to page 1', async () => {
    const user = userEvent.setup()

    renderWithProviders(<IncidentsTab onOpen={vi.fn()} />)
    expect(listMock).toHaveBeenLastCalledWith('all', 1)

    await user.click(screen.getByRole('button', { name: 'Resolved' }))

    expect(listMock).toHaveBeenLastCalledWith('resolved', 1)
  })

  it('opens the panel when a row is clicked', async () => {
    const onOpen = vi.fn()
    const user = userEvent.setup()

    renderWithProviders(<IncidentsTab onOpen={onOpen} />)
    await user.click(screen.getByText('Disk full'))

    expect(onOpen).toHaveBeenCalledWith('i2')
  })

  it('pages by 20', async () => {
    listMock.mockImplementation(() => list([makeIncident()], 45))
    const user = userEvent.setup()

    renderWithProviders(<IncidentsTab onOpen={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /page 2/i }))

    expect(listMock).toHaveBeenLastCalledWith('all', 2)
  })
})

describe('alert incident parts', () => {
  const summary = { id: 'i1', title: 'A very long incident title indeed', status: 'open' as const, comment_count: 0 }

  it('shows the incident of an attached alert in its column, colored by status, and opens it on click', async () => {
    const onOpen = vi.fn()
    const user = userEvent.setup()

    renderWithProviders(<IncidentCell summary={summary} onOpen={onOpen} />)

    const chip = screen.getByRole('button', { name: 'Open · A very long incident title indeed' })

    expect(chip).toHaveClass('MuiChip-colorError')
    await user.click(chip)
    expect(onOpen).toHaveBeenCalledWith('i1')
  })

  it('leaves the incident column empty for a free alert', () => {
    const { container } = renderWithProviders(<IncidentCell onOpen={vi.fn()} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('offers to open an incident on a free alert only, the column showing an attached one', async () => {
    const onOpen = vi.fn()
    const user = userEvent.setup()
    const alert = { id: 'a1', type: 'node_down', connection_id: 'c1' }

    const { rerender } = renderWithProviders(
      <IncidentButtons alert={alert} summary={undefined} canManage onOpen={onOpen} onAvailability={vi.fn()} />,
    )

    await user.click(screen.getByRole('button', { name: 'Open an incident' }))
    expect(onOpen).toHaveBeenCalledWith(null, 'a1')

    rerender(<IncidentButtons alert={alert} summary={summary} canManage onOpen={onOpen} onAvailability={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Open an incident' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'View the incident' })).toBeNull()
  })

  it('hides open for a reader, and availability for a non outage alert', () => {
    renderWithProviders(
      <IncidentButtons alert={{ id: 'a1', type: 'cpu_high', connection_id: 'c1' }} summary={undefined} canManage={false} onOpen={vi.fn()} onAvailability={vi.fn()} />,
    )

    expect(screen.queryByRole('button', { name: 'Open an incident' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'View availability' })).toBeNull()
  })

  it('links an outage alert to its connection availability', async () => {
    const onAvailability = vi.fn()
    const user = userEvent.setup()

    renderWithProviders(
      <IncidentButtons alert={{ id: 'a1', type: 'vm_down', connection_id: 'c1' }} summary={undefined} canManage onOpen={vi.fn()} onAvailability={onAvailability} />,
    )
    await user.click(screen.getByRole('button', { name: 'View availability' }))

    await waitFor(() => expect(onAvailability).toHaveBeenCalledWith('/operations/availability#conn-c1'))
  })

  it('recognises the refusal of an attached alert', async () => {
    const refused = { status: 409, json: async () => ({ error: 'alert_in_incident', code: 'ALERT_IN_INCIDENT' }) } as Response
    const other = { status: 409, json: async () => ({ code: 'OTHER' }) } as Response
    const broken = { status: 409, json: async () => { throw new Error('x') } } as unknown as Response

    expect(await isAlertInIncidentResponse(refused)).toBe(true)
    expect(await isAlertInIncidentResponse(other)).toBe(false)
    expect(await isAlertInIncidentResponse(broken)).toBe(false)
    expect(await isAlertInIncidentResponse({ status: 200 } as Response)).toBe(false)
  })

  it('summarizes a batch of deletes: one attached alert kept, two deleted', async () => {
    const ok = { status: 200 } as Response
    const refused = { status: 409, json: async () => ({ code: 'ALERT_IN_INCIDENT' }) } as Response

    expect(await summarizeDeletes([ok, refused, ok])).toEqual({ kept: 1, neutral: 0, deleted: 2, failed: 0 })
  })

  it('counts ALERT_LOCKED as kept too, flagged neutral', async () => {
    const ok = { status: 200 } as Response
    const locked = { status: 409, json: async () => ({ code: 'ALERT_LOCKED' }) } as Response
    const refused = { status: 409, json: async () => ({ code: 'ALERT_IN_INCIDENT' }) } as Response

    expect(await isAlertInIncidentResponse(locked)).toBe(true)
    expect(await summarizeDeletes([ok, locked, refused])).toEqual({ kept: 2, neutral: 1, deleted: 1, failed: 0 })
  })

  it('counts a 409 with another code, an invalid JSON or a 500 as failed, not kept nor deleted', async () => {
    const other = { status: 409, json: async () => ({ code: 'OTHER' }) } as Response
    const broken = { status: 409, json: async () => { throw new Error('x') } } as unknown as Response
    const crashed = { status: 500 } as Response

    expect(await summarizeDeletes([other, broken])).toEqual({ kept: 0, neutral: 0, deleted: 0, failed: 2, firstError: 'HTTP 409' })
    expect(await summarizeDeletes([{ status: 200 } as Response, crashed])).toEqual({ kept: 0, neutral: 0, deleted: 1, failed: 1, firstError: 'HTTP 500' })
  })
})

describe('AlertsTabs', () => {
  const props = { tab: 0, onChange: vi.fn(), activeCount: 3, rulesCount: 2, incidentCount: 7 }

  it('has no Incidents tab when the register is off', () => {
    renderWithProviders(<AlertsTabs {...props} incidentsEnabled={false} />)

    expect(screen.getAllByRole('tab')).toHaveLength(2)
    expect(screen.queryByRole('tab', { name: /Incidents/ })).toBeNull()
  })

  it('has an Incidents tab with the count when the register is on', () => {
    renderWithProviders(<AlertsTabs {...props} incidentsEnabled />)

    expect(screen.getAllByRole('tab')).toHaveLength(3)
    expect(screen.getByRole('tab', { name: 'Incidents (7)' })).toBeInTheDocument()
  })
})

describe('AlertMessageCell', () => {
  it('shows the message and its occurrences, the incident living in its own column', () => {
    renderWithProviders(<AlertMessageCell message='Node pve1 is down' occurrences={4} />)

    expect(screen.getByText('Node pve1 is down')).toBeInTheDocument()
    expect(screen.getByText('4 occurrence(s)')).toBeInTheDocument()
  })
})
