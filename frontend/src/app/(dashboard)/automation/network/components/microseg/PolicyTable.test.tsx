/**
 * Policy sub-tab (UA58): the flow table grouped by destination zone, its filter, the state of each flow and the diff
 * badges against the applied revision, the uncovered traffic of each zone over 24 hours from the persisted history.
 */

import { describe, expect, it } from 'vitest'
import { within } from '@testing-library/react'

import { screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'
import type { MicrosegFlow, MicrosegTrafficBucket } from '@/lib/microseg/types'

import { BASE, calls, fetchMock, flow, mock, policy, renderTab, reply, revisionWithSnapshot, zone } from './microsegTestKit'
import { db, setup, installFreshMocks, web } from './policyTestKit'

installFreshMocks()

const f = (id: string, over: Partial<MicrosegFlow>): MicrosegFlow => ({ ...flow(id), ...over })
const table = () => screen.findByRole('table', { name: 'Flows' })
const group = (t: HTMLElement, name: string) => within(t).getByRole('rowgroup', { name })
const rowsOf = (g: HTMLElement) => within(g).getAllByRole('row').slice(1) as HTMLTableRowElement[]
const trafficReads = () => fetchMock.mock.calls.filter(([u]) => String(u).startsWith(`${BASE}/traffic?`))
const bucket = (src: string, dst: string, hits: number, verdict = 'would_block'): MicrosegTrafficBucket => ({ at: '2026-11-03T09:00:00Z', zone: dst, src_zone: src, verdict, hits })

describe('flow table: groups and filter', () => {
  const flows = [
    f('f1', { src_zone_id: 'zw', dst_zone_id: 'zd', dport: '5432' }),
    f('f2', { src_zone_id: 'zd', dst_zone_id: 'zw', dport: '22' }),
    f('f3', { src_zone_id: 'zw', dst_zone_id: 'zd', dport: '22' }),
    f('f4', { src_zone_id: 'zw', dst_zone_id: '', dst_cidr: '10.0.0.0/8', proto: 'udp', dport: '53' }),
  ]

  it('groups the flows by destination zone, in the order of the zones, the CIDR destinations last', async () => {
    setup({ zones: [web(), db()], flows })
    const t = await table()
    const names = within(t).getAllByRole('rowgroup').map(g => g.getAttribute('aria-label')).filter(Boolean)
    expect(names).toEqual(['web', 'db', 'Outside the zones'])
    const dbGroup = group(t, 'db')
    expect(within(dbGroup).getByText('2 flows')).toBeTruthy()
    expect(rowsOf(dbGroup)).toHaveLength(2)
    expect(within(t).getAllByRole('columnheader').map(c => c.textContent)).toEqual(['Source', 'Destination', 'Service', 'State', 'Actions'])
  })

  it('folds a group under its chevron and adds a flow into its zone from its header', async () => {
    setup({ zones: [web(), db()], flows })
    const dbGroup = group(await table(), 'db')
    fireEvent.click(within(dbGroup).getByRole('button', { name: 'Hide details' }))
    expect(rowsOf(dbGroup)).toHaveLength(0)
    fireEvent.click(within(dbGroup).getByRole('button', { name: 'Show details' }))
    expect(rowsOf(dbGroup)).toHaveLength(2)

    fireEvent.click(within(dbGroup).getByRole('button', { name: 'New flow into db' }))
    const dialog = await screen.findByRole('dialog', { name: 'New flow' })
    expect(within(dialog).getByRole('combobox', { name: 'Destination zone' }).textContent).toContain('db')
  })

  it('filters on a zone or a service, and says so when nothing is left', async () => {
    setup({ zones: [web(), db()], flows })
    const t = await table()
    const filter = screen.getByRole('textbox', { name: 'Filter by zone or service' })

    fireEvent.change(filter, { target: { value: 'ssh' } })
    await waitFor(() => expect(within(t).queryByRole('rowgroup', { name: 'Outside the zones' })).toBeNull())
    expect(rowsOf(group(t, 'db'))).toHaveLength(1)
    expect(rowsOf(group(t, 'web'))).toHaveLength(1)

    fireEvent.change(filter, { target: { value: 'POSTGRES' } })
    await waitFor(() => expect(within(t).queryByRole('rowgroup', { name: 'web' })).toBeNull())
    expect(rowsOf(group(t, 'db'))).toHaveLength(1)

    fireEvent.change(filter, { target: { value: '10.0.0' } })
    expect(await screen.findByRole('rowgroup', { name: 'Outside the zones' })).toBeTruthy()

    fireEvent.change(filter, { target: { value: 'nothing-like-it' } })
    expect(await screen.findByText('No flow matches the filter.')).toBeTruthy()
  })

  it('sorts the rows of a group by source', async () => {
    const app = zone('za', { name: 'app' })
    setup({ zones: [web(), db(), app], flows: [f('f1', { src_zone_id: 'zd', dst_zone_id: 'zw' }), f('f2', { src_zone_id: 'za', dst_zone_id: 'zw' })] })
    const t = await table()
    expect(rowsOf(group(t, 'web')).map(r => r.cells[0].textContent)).toEqual(['app', 'db'])
    expect(screen.queryByRole('combobox', { name: 'Sort by' })).toBeNull()
  })
})

describe('flow table: state against the applied revision, diff badges', () => {
  it('says applied, pending add, pending change, pending removal (struck through) or not applied in v1', async () => {
    const kept = f('f1', { src_zone_id: 'zw', dst_zone_id: 'zd', dport: '443' })
    const changed = f('f2', { src_zone_id: 'zw', dst_zone_id: 'zd', dport: '22' })
    const removed = f('f4', { src_zone_id: 'zd', dst_zone_id: 'zw', dport: '80' })
    mock.routes['GET /revisions?limit=1'] = () => reply(200, { revisions: [revisionWithSnapshot([web(), db()], [kept, { ...changed, dport: '2222' }, removed])] })
    const added = f('f3', { src_zone_id: 'zd', dst_zone_id: 'zw', dport: '8080' })
    const toCidr = f('f5', { src_zone_id: 'zw', dst_zone_id: '', dst_cidr: '192.0.2.0/24', proto: 'udp', dport: '53' })
    setup({ zones: [web(), db()], flows: [kept, changed, added, toCidr], pending_changes: true })

    const t = await table()
    const stateOf = (g: string, service: string) => rowsOf(group(t, g)).find(r => r.cells[2].textContent?.includes(service))!
    await waitFor(() => expect(stateOf('db', 'HTTPS').cells[3].textContent).toBe('Applied'))
    expect(stateOf('db', 'SSH').cells[3].textContent).toBe('Pending change')
    expect(stateOf('web', 'HTTP-alt').cells[3].textContent).toBe('Pending add')
    const gone = stateOf('web', 'HTTP')
    expect(gone.cells[3].textContent).toBe('Pending removal')
    expect(gone.getAttribute('data-removed')).toBe('true')
    expect(getComputedStyle(gone.cells[0]).textDecoration).toContain('line-through')
    expect(within(gone).queryByRole('button', { name: 'Edit flow' })).toBeNull()
    expect(stateOf('Outside the zones', 'DNS').cells[3].textContent).toBe('Not applied in v1')

    expect(await screen.findByText('What will change: 2 flows added, 1 flow changed, 1 flow removed')).toBeTruthy()
  })

  it('badges the zones added and changed, and keeps a removed zone struck through until the next apply', async () => {
    const old = zone('zo', { name: 'old' })
    mock.routes['GET /revisions?limit=1'] = () => reply(200, { revisions: [revisionWithSnapshot([web(), db({ state: 'enforce' }), old], [f('f9', { src_zone_id: 'zw', dst_zone_id: 'zo' })])] })
    const fresh = zone('zn', { name: 'fresh' })
    setup({ zones: [web(), db(), fresh], pending_changes: true })

    const dbRow = await screen.findByRole('listitem', { name: 'db' })
    expect(await within(dbRow).findByText('Changed')).toBeTruthy()
    expect(within(screen.getByRole('listitem', { name: 'fresh' })).getByText('Added')).toBeTruthy()
    expect(within(screen.getByRole('listitem', { name: 'web' })).queryByText(/Added|Changed|Removed/)).toBeNull()
    const gone = screen.getByRole('listitem', { name: 'old' })
    expect(gone.getAttribute('data-removed')).toBe('true')
    expect(within(gone).getByText('Removed')).toBeTruthy()
    expect(getComputedStyle(within(gone).getByText('old')).textDecoration).toContain('line-through')
    expect(within(gone).queryByRole('button')).toBeNull()

    // The flow into the removed zone stays in its (removed) group, struck through.
    const t = await table()
    const oldGroup = group(t, 'old')
    expect(within(oldGroup).getByText('Removed')).toBeTruthy()
    expect(rowsOf(oldGroup)[0].cells[3].textContent).toBe('Pending removal')
    expect(within(oldGroup).queryByRole('button', { name: 'New flow into old' })).toBeNull()
    expect(screen.getByText('What will change: 1 zone added, 1 zone changed, 1 zone removed, 1 flow removed')).toBeTruthy()
  })

  it('marks every flow pending add when nothing was applied yet', async () => {
    window.localStorage.setItem('microseg.subTab', 'policy')
    mock.routes['GET /policy'] = () => reply(200, policy({ zones: [web(), db()], flows: [f('f1', { src_zone_id: 'zw', dst_zone_id: 'zd' })], last_revision: null, pending_changes: true }))
    renderTab()
    const t = await table()
    await waitFor(() => expect(rowsOf(group(t, 'db'))[0].cells[3].textContent).toBe('Pending add'))
    expect(calls('GET /revisions?limit=1')).toHaveLength(0)
  })
})

describe('flow table: uncovered traffic of each zone', () => {
  const flows = [
    f('f1', { src_zone_id: 'zw', dst_zone_id: 'zd' }),
    f('f2', { src_zone_id: 'zd', dst_zone_id: 'zw', dport: '22' }),
    f('f3', { src_zone_id: 'zw', dst_zone_id: '', dst_cidr: '10.0.0.0/8', proto: 'udp', dport: '53' }),
  ]

  it('reads the history once for the tab, 24 hours in hour steps, and sums what each zone logged on its group', async () => {
    mock.routes['GET /traffic*'] = () => reply(200, {
      step: 3600, from: '', to: '',
      buckets: [bucket('web', 'db', 5), bucket('', 'DB', 2, 'blocked'), bucket('db', 'other', 9)],
    })
    setup({ zones: [web(), db()], flows })
    const t = await table()
    const dbChip = await within(group(t, 'db')).findByRole('button', { name: 'Uncovered 24 h: 7 hits' })
    expect(dbChip.classList.contains('MuiChip-colorWarning')).toBe(true)
    const webChip = within(group(t, 'web')).getByRole('button', { name: 'Uncovered 24 h: 0 hits' })
    expect(webChip.classList.contains('MuiChip-colorWarning')).toBe(false)
    expect(within(group(t, 'Outside the zones')).queryByText(/Uncovered/)).toBeNull()
    fireEvent.mouseOver(webChip)
    expect(await screen.findByText("Traffic into this zone that no flow covers (logged by the zone's members over the last 24 h)")).toBeTruthy()
    // No per-flow usage: the history does not hold it.
    expect(within(t).queryByText(/^\d+ hits?$/)).toBeNull()

    const reads = trafficReads()
    expect(reads).toHaveLength(1)
    const url = new URL(String(reads[0][0]), 'http://x')
    expect(url.searchParams.get('step')).toBe('3600')
    expect(Date.parse(url.searchParams.get('to')!) - Date.parse(url.searchParams.get('from')!)).toBe(24 * 3600_000)
  })

  it('opens the Observation sub-tab filtered on the zone', async () => {
    mock.routes['GET /traffic*'] = () => reply(200, { step: 3600, from: '', to: '', buckets: [bucket('web', 'db', 5)] })
    mock.routes['GET /suggestions*'] = () => reply(200, { suggestions: [], limit: 26, offset: 0 })
    setup({ zones: [web(), db()], flows })
    fireEvent.click(await within(group(await table(), 'db')).findByRole('button', { name: 'Uncovered 24 h: 5 hits' }))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Observation' }).getAttribute('aria-selected')).toBe('true'))
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).startsWith(`${BASE}/suggestions?`) && new URL(String(u), 'http://x').searchParams.get('zone') === 'zd')).toBe(true))
  })

  it('shows no count when the history cannot be read, and never asks Proxmox', async () => {
    mock.routes['GET /traffic*'] = () => reply(503, { code: 'ORCHESTRATOR_UNAVAILABLE', error: 'down' })
    setup({ zones: [web(), db()], flows })
    const t = await table()
    await waitFor(() => expect(trafficReads()).toHaveLength(1))
    expect(within(t).queryByText(/Uncovered/)).toBeNull()
    const urls = fetchMock.mock.calls.map(c => String(c[0]))
    expect(urls.filter(u => !u.startsWith('/api/v1/firewall/microseg/') && !u.startsWith('/api/v1/vms'))).toEqual([])
  })
})
