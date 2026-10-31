import { cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { type Theme, useTheme } from '@mui/material/styles'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AvailabilityState } from '@/lib/availability/types'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

import AvailabilityTimeline from './AvailabilityTimeline'
import { makeResult } from './fixtures'
import { IncidentDialogContext } from './IncidentDialogContext'

const { enabledMock, openSpy, fetchMock } = vi.hoisted(() => ({ enabledMock: vi.fn(), openSpy: vi.fn(), fetchMock: vi.fn() }))

vi.mock('@/components/incidents/useIncidentsEnabled', () => ({ useIncidentsEnabled: () => enabledMock() }))

afterEach(cleanup)

/** The bar of index `i` of a row, the target the pointer reports. */
const barAt = (row: HTMLElement, i: number) => row.querySelector(`[data-i="${i}"]`) as HTMLElement

const rows = [
  { label: 'pve1', result: makeResult('pve1', ['up', 'down', 'maintenance', 'unobserved', 'absent'], { availability: 99.93, incidents: [{ from: 'a', to: 'b', state: 'down' }] }) },
]

describe('AvailabilityTimeline', () => {
  it('renders one bar per minute on a one-hour row, colored by its state', () => {
    let palette: Theme['palette'] | undefined

    function Probe() {
      palette = useTheme().palette

      return null
    }

    const { container } = renderWithProviders(<><Probe /><AvailabilityTimeline rows={rows} /></>)
    const slots = Array.from(container.querySelectorAll('[data-state]'))

    expect(slots.map(s => s.getAttribute('data-state'))).toEqual(['up', 'down', 'maintenance', 'unobserved', 'absent'])
    expect(slots[0]).toHaveStyle({ backgroundColor: palette!.success.main })
    expect(slots[1]).toHaveStyle({ backgroundColor: palette!.error.main })
    expect(slots[2]).toHaveStyle({ backgroundColor: palette!.info.main })
    expect(slots[3]).toHaveStyle({ backgroundColor: palette!.grey[400] })
    // A period never seen is an empty grey bar, not a hole in the row.
    expect(slots[4]).toHaveStyle({ backgroundColor: palette!.action.hover })
  })

  it('gives each row one summary label instead of one label per slot', () => {
    renderWithProviders(<AvailabilityTimeline rows={rows} />)

    expect(screen.getByRole('img', { name: 'pve1: 99.93% available, 1 outage' })).toBeInTheDocument()
    expect(screen.getAllByRole('img')).toHaveLength(1)
  })

  it('says not measured, never 0%, for a null availability', () => {
    const r = makeResult('pve2', ['unobserved'], { availability: null, coverage: null })

    renderWithProviders(<AvailabilityTimeline rows={[{ label: 'pve2', result: r }]} />)

    expect(screen.getByRole('img', { name: 'pve2: not measured' })).toBeInTheDocument()
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
  })

  it('tells the period under the pointer in a tooltip, without a click', async () => {
    renderWithProviders(<AvailabilityTimeline rows={rows} to='2026-10-27T10:05:00.000Z' />)

    const bar = screen.getByRole('img')

    fireEvent.mouseMove(barAt(bar, 1))

    const tip = await screen.findByRole('tooltip')
    expect(tip).toHaveTextContent(/^.* → .*0% available.*Down · .* → .* · 1mClick for the detail$/)

    fireEvent.mouseLeave(bar)
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument())
  })

  it('keeps the bar under the pointer when it moves into the gap between two bars', async () => {
    renderWithProviders(<AvailabilityTimeline rows={rows} to='2026-10-27T10:05:00.000Z' />)

    const bar = screen.getByRole('img')

    fireEvent.mouseMove(barAt(bar, 0))
    fireEvent.mouseMove(bar)

    expect(await screen.findByRole('tooltip')).toHaveTextContent('100% available')
  })

  it('tells how far back the row starts and that it ends now', () => {
    renderWithProviders(<AvailabilityTimeline rows={rows} to='2026-10-27T10:05:00.000Z' />)

    expect(screen.getByText('5 minutes ago')).toBeInTheDocument()
    expect(screen.getByText('Now')).toBeInTheDocument()
  })

  it('shows a legend for the five states', () => {
    renderWithProviders(<AvailabilityTimeline rows={[]} />)

    for (const name of ['Up', 'Down', 'Maintenance', 'Not observed', 'Absent']) {
      expect(screen.getByText(name)).toBeInTheDocument()
    }
  })

  it('words the current state of the row on its right', () => {
    renderWithProviders(<AvailabilityTimeline rows={[{ label: 'pve3', result: makeResult('pve3', ['up', 'down']) }]} />)

    expect(screen.getAllByText('Down')).toHaveLength(2)
  })
})

describe('AvailabilityTimeline outage incident', () => {
  const hover = (bar: HTMLElement, i: number) => fireEvent.mouseMove(barAt(bar, i))

  const answer = (match: unknown) => fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ matches: [match] }) })

  const renderRow = () => renderWithProviders(
    <IncidentDialogContext.Provider value={{ open: openSpy }}>
      <AvailabilityTimeline rows={rows} to='2026-10-27T10:05:00.000Z' />
    </IncidentDialogContext.Provider>,
  )

  beforeEach(() => {
    enabledMock.mockReset().mockReturnValue(true)
    openSpy.mockReset()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('names the incident and its comments in the tooltip, and opens it from the bar detail', async () => {
    answer({ alerts: [{ id: 'a1' }], incident: { id: 'i1', title: 'Node pve1 down', status: 'open', comment_count: 3 } })
    renderRow()

    const bar = screen.getByRole('img')

    hover(bar, 1)
    expect(await screen.findByText('Incident: Node pve1 down (3 comments)')).toBeInTheDocument()

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)

    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/incidents/for-outages')
    expect(body.outages).toEqual([{ connection_id: 'c1', kind: 'node', node: 'pve1', vmid: 0, from: '2026-10-27T10:01:00.000Z', to: '2026-10-27T10:02:00.000Z' }])
    expect(bar).toHaveStyle({ cursor: 'pointer' })
    fireEvent.click(barAt(bar, 1))
    expect(await screen.findByText('Node pve1 down')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'View the incident' }))
    expect(openSpy).toHaveBeenCalledWith('i1')
  })

  it('counts the alerts when no incident covers the outage, and seeds the panel with the first', async () => {
    answer({ alerts: [{ id: 'a1' }, { id: 'a2' }], incident: null })
    renderRow()

    const bar = screen.getByRole('img')

    hover(bar, 1)
    expect(await screen.findByText('2 alerts, no incident opened')).toBeInTheDocument()
    fireEvent.click(barAt(bar, 1))
    fireEvent.click(await screen.findByRole('button', { name: 'Open an incident' }))
    expect(openSpy).toHaveBeenCalledWith(null, 'a1')
  })

  it('adds no line and no action when nothing matches', async () => {
    answer({ alerts: [], incident: null })
    renderRow()

    const bar = screen.getByRole('img')

    hover(bar, 1)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/Down · .* → .* · 1mClick for the detail$/)
    fireEvent.click(barAt(bar, 1))
    expect(await screen.findByText('Events of the period')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /incident/ })).toBeNull()
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('details a calm bar, a maintenance, and closes', async () => {
    renderRow()

    const bar = screen.getByRole('img')

    fireEvent.click(barAt(bar, 0))
    expect(await screen.findByText('No outage in this period.')).toBeInTheDocument()
    expect(screen.getByText('Up: 1m')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByText('No outage in this period.')).toBeNull())

    fireEvent.click(barAt(bar, 2))
    expect(await screen.findByText(/^Maintenance · /)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('asks nothing of a run that is not down', () => {
    renderRow()
    hover(screen.getByRole('img'), 0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('asks for every outage of a wide bar and opens the incident of any of them', async () => {
    const day = Array.from({ length: 1440 }, (_, i) => (i === 2 || i === 5 ? 'down' : 'up') as AvailabilityState)

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ matches: [{ alerts: [{ id: 'a1' }], incident: null }, { alerts: [{ id: 'a2' }], incident: { id: 'i2', title: 'Second', status: 'open', comment_count: 0 } }] }),
    })
    renderWithProviders(
      <IncidentDialogContext.Provider value={{ open: openSpy }}>
        <AvailabilityTimeline rows={[{ label: 'pve1', result: makeResult('pve1', day) }]} />
      </IncidentDialogContext.Provider>,
    )

    const bar = screen.getByRole('img')

    hover(bar, 0)
    expect(await screen.findByText('Incident: Second (0 comments)')).toBeInTheDocument()
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).outages).toHaveLength(2)
    fireEvent.click(barAt(bar, 0))
    const detail = within(await screen.findByRole('region', { name: 'Detail of the period' }))

    expect(detail.getAllByText(/^Down · /)).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Open an incident' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'View the incident' }))
    expect(openSpy).toHaveBeenCalledWith('i2')
  })

  it('sends no request and offers no incident action when the register is not on offer', async () => {
    enabledMock.mockReturnValue(false)
    renderRow()

    const bar = screen.getByRole('img')

    hover(bar, 1)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/Down · .* → .* · 1m/)
    fireEvent.click(barAt(bar, 1))
    expect(await screen.findByText(/^Down · /)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /incident/ })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(openSpy).not.toHaveBeenCalled()
  })
})
