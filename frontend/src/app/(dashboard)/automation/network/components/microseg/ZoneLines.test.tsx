/**
 * The zones of the Policy sub-tab as rows: the switch between cards and rows (kept in the browser), one row per zone
 * with its chips, counters and the uncovered traffic as a line, the details opened below the row, and a removed zone
 * struck through.
 */
import { describe, expect, it, vi } from 'vitest'
import { within } from '@testing-library/react'

import { fireEvent, renderWithProviders, screen, waitFor } from '@/__tests__/setup/renderWithProviders'
import type { MicrosegFlow } from '@/lib/microseg/types'

import { db, installFreshMocks, setup, vm, web } from './policyTestKit'
import { flow } from './microsegTestKit'
import SparkLine, { linePoints } from './SparkLine'
import ZoneLine, { RemovedZoneLine } from './ZoneLine'
import { ZONE_LAYOUT_KEY } from './ZoneList'
import { ZoneSparkCell } from './ZoneSparkline'

installFreshMocks()

const lineProps = () => ({
  zone: web({ label: 'Front web servers' }), members: [], membersKnown: true, flows: [] as MicrosegFlow[], zonesById: new Map(), flowDiff: null, drifts: 2, open: false,
  onToggle: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), onSetState: vi.fn(), onAssign: vi.fn(), onRemoveMember: vi.fn(),
  onAddFlow: vi.fn(), onEditFlow: vi.fn(), onDeleteFlow: vi.fn(), onOpenDrifts: vi.fn(),
})

describe('zones as rows on the Policy sub-tab', () => {
  it('switches to rows, one per zone under the column titles, keeps the choice, and opens the details below a row', async () => {
    const out: MicrosegFlow = { ...flow('f1'), src_zone_id: 'zw', dst_zone_id: 'zd' }
    setup({ zones: [web(), db()], flows: [out], vms: [vm(100, 'web-1', ['zone-web'])] })
    await screen.findByRole('listitem', { name: 'web' })
    expect(screen.getByRole('button', { name: 'Cards' }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Rows' }))
    const rows = await waitFor(() => {
      const list = document.querySelector<HTMLElement>('[data-layout=rows]')
      expect(list).toBeTruthy()
      return list as HTMLElement
    })
    expect(window.localStorage.getItem(ZONE_LAYOUT_KEY)).toBe('rows')
    expect(screen.getByText('Members')).toBeTruthy()
    expect(screen.getByText('Incoming')).toBeTruthy()
    const row = within(rows).getByRole('listitem', { name: 'web' })
    await waitFor(() => expect(row.querySelector('[data-stat=members]')?.textContent).toBe('1'))
    expect(row.querySelector('[data-stat=outgoing]')?.textContent).toBe('1')
    expect(within(rows).getByRole('listitem', { name: 'db' }).querySelector('[data-stat=incoming]')?.textContent).toBe('1')

    fireEvent.click(within(row).getByRole('button', { name: 'Show details of web' }))
    expect(await screen.findByRole('region', { name: 'Details of web' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Cards' }))
    expect(window.localStorage.getItem(ZONE_LAYOUT_KEY)).toBe('cards')
    expect(document.querySelector('[data-layout=rows]')).toBeNull()
  })

  it('starts on the rows when the browser kept them, and offers no switch without a zone', async () => {
    window.localStorage.setItem(ZONE_LAYOUT_KEY, 'rows')
    const view = setup({ zones: [web()] })
    await screen.findByRole('listitem', { name: 'web' })
    expect(document.querySelector('[data-layout=rows]')).toBeTruthy()
    view.unmount()
    setup({ zones: [] })
    expect(await screen.findByText(/No zone yet/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Rows' })).toBeNull()
  })
})

describe('ZoneLine', () => {
  it('shows the zone, its chips, the actions and the chevron on one row', () => {
    const p = lineProps()
    renderWithProviders(<ZoneLine {...p} />)
    const row = screen.getByRole('listitem', { name: 'web' })
    expect(within(row).getByLabelText('Front web servers')).toBeTruthy()
    // The outbound chip keeps its icon: its words are in the tooltip.
    expect(within(row).getByTestId('egress-chip').getAttribute('aria-label')).toBeTruthy()
    fireEvent.click(within(row).getByText('2 drifts'))
    expect(p.onOpenDrifts).toHaveBeenCalledWith(p.zone)
    fireEvent.click(within(row).getByRole('button', { name: 'Observation' }))
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Enforce' }))
    expect(p.onSetState).toHaveBeenCalledWith(p.zone, 'enforce')
    for (const name of ['Edit zone', 'New flow into web', 'Assign guests', 'Delete zone']) expect(within(row).getByRole('button', { name })).toBeTruthy()
    fireEvent.click(within(row).getByRole('button', { name: 'Show details of web' }))
    expect(p.onToggle).toHaveBeenCalledTimes(1)
  })

  it('draws the uncovered traffic as a line with its total when the history is read', () => {
    const series = new Array<number>(24).fill(0)
    series[20] = 12
    renderWithProviders(<ZoneLine {...lineProps()} open uncovered={{ series, from: 0, stepMs: 3_600_000 }} />)
    const row = screen.getByRole('listitem', { name: 'web' })
    expect(within(row).getByTestId('zone-sparkline-total').textContent).toBe('12 would be blocked')
    expect(within(row).getByRole('img', { name: 'Uncovered traffic over the last 24 hours: 12 hits' })).toBeTruthy()
    expect(within(row).getByRole('button', { name: 'Hide details of web' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('strikes a removed zone through, with its badge and no action', () => {
    renderWithProviders(<RemovedZoneLine zone={web()} />)
    const row = screen.getByRole('listitem', { name: 'web' })
    expect(row.getAttribute('data-removed')).toBe('true')
    expect(getComputedStyle(within(row).getByText('web')).textDecoration).toContain('line-through')
    expect(within(row).getByText('Removed')).toBeTruthy()
    expect(within(row).queryByRole('button')).toBeNull()
  })
})

describe('ZoneSparkCell and SparkLine', () => {
  it('says a disabled zone logs nothing, and reads while the history is read', () => {
    const { unmount } = renderWithProviders(<ZoneSparkCell state='disabled' series={[1]} />)
    expect(screen.getByText('Zone disabled: its traffic is not logged')).toBeTruthy()
    unmount()
    renderWithProviders(<ZoneSparkCell state='enforce' series={null} />)
    expect(screen.getByTestId('zone-sparkline-total').textContent).toBe('Reading the history...')
  })

  it('words the inbound and the outbound totals, and draws the outbound as its own line', () => {
    renderWithProviders(<ZoneSparkCell state='enforce' series={[3, 0]} outSeries={[0, 4]} outState='enforce' />)
    expect(screen.getByTestId('zone-sparkline-total').textContent).toBe('3 blocked · 4 outbound blocked')
    expect(document.querySelector('polyline[data-second]')).toBeTruthy()
  })

  it('scales the line on the highest bucket, and draws a flat track without an area when nothing was counted', () => {
    expect(linePoints([0, 10, 5], 10, 22)).toBe('5,21.00 15,1.00 25,11.00')
    const { container, unmount } = renderWithProviders(<SparkLine series={[0, 0]} colour='warning.main' height={20} ariaLabel='none' />)
    expect(container.querySelector('polygon')).toBeNull()
    expect(container.querySelector('polyline')?.getAttribute('points')).toBe('5,19.00 15,19.00')
    unmount()
    const drawn = renderWithProviders(<SparkLine series={null} size={3} colour='warning.main' height={20} ariaLabel='reading' />)
    expect(drawn.container.querySelector('polyline')?.getAttribute('points')?.split(' ')).toHaveLength(3)
  })
})
