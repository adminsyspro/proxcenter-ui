/**
 * Observation sub-tab: the flows seen by the engine as suggestions, filtered and
 * paged by the server, accepted (as a zone flow or as a CIDR) or dismissed one
 * by one or in bulk.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, within } from '@testing-library/react'

import { screen, fireEvent, renderWithProviders, waitFor } from '@/__tests__/setup/renderWithProviders'
import type { MicrosegSuggestion } from '@/lib/microseg/types'

import { calls, mock, policy, renderTab, reply, zone, BASE, fetchMock, REVISION_HEAD } from './microsegTestKit'
import ObservationPanel from './ObservationPanel'
import { body, installFreshMocks } from './policyTestKit'

installFreshMocks()

// Dates are formatted in the zone of the process: pin it so the expected strings do not depend on the machine.
const originalTZ = process.env.TZ
beforeAll(() => { process.env.TZ = 'UTC' })
afterAll(() => {
  if (originalTZ === undefined) delete process.env.TZ
  else process.env.TZ = originalTZ
})

const web = zone('zw', { name: 'web' })
const db = zone('zd', { name: 'db' })

const sug = (id: string, over: Partial<MicrosegSuggestion> = {}): MicrosegSuggestion => ({
  id, policy_id: 'p1', kind: 'would_block', src_key: `k${id}`, src_ip: '', src_zone_id: 'zw', dst_ip: '10.0.0.9', dst_zone_id: 'zd',
  proto: 'tcp', dport: '443', hits: 12, first_seen: '2026-11-01T10:00:00Z', last_seen: '2026-11-02T12:00:00Z', status: 'pending', ...over,
})

const ROUTE = 'GET /suggestions?limit=26&status=pending'
const listCalls = () => fetchMock.mock.calls.map(([u]) => String(u).replace(BASE, '')).filter(u => u.startsWith('/suggestions?'))

function setup(suggestions: MicrosegSuggestion[], opts: { route?: string; pending?: boolean } = {}) {
  window.localStorage.setItem('microseg.subTab', 'observation')
  mock.routes['GET /policy'] = () => reply(200, policy({ zones: [web, db], last_revision: REVISION_HEAD }))
  mock.routes[opts.route ?? ROUTE] = () => reply(200, { suggestions, limit: 26, offset: 0 })
  mock.routes['POST /suggestions/resolve'] = () => reply(200, { version: 4 })
  return renderTab()
}

const row = (name: RegExp | string) => screen.findByRole('row', { name })
/** The flow rows of the table (not the header, the group headers or the details). */
const flowRows = () => screen.getAllByRole('row').filter(r => r.hasAttribute('data-suggestion'))
const findFlowRows = async () => { await waitFor(() => expect(flowRows().length).toBeGreaterThan(0)); return flowRows() }
const unknownSource = sug('u1', { src_zone_id: '', src_ip: '192.168.1.50' })

describe('observation list', () => {
  it('shows one row per flow: source, destination, service, hits, last seen and status', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-02T14:00:00Z'))
    try {
      setup([sug('s1'), unknownSource])
      const line = await row('web to db')
      expect(within(line).getByText('web')).toBeTruthy()
      expect(within(line).getByText('db')).toBeTruthy()
      expect(within(line).getByText('HTTPS')).toBeTruthy()
      expect(within(line).getByText('12')).toBeTruthy()
      expect(within(line).getByText('2 hours ago')).toBeTruthy()
      expect(within(line).getByText('Would be blocked')).toBeTruthy()
      expect(line.querySelector('i.ri-eye-line')).toBeTruthy()
      expect(screen.getByRole('columnheader', { name: 'Last seen' })).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('gives the absolute date of the last time in the tooltip of the relative one', async () => {
    setup([sug('s1')])
    const line = await row('web to db')
    fireEvent.mouseOver(within(line).getByText(/ago$/))
    expect(await screen.findByText(/Last seen Nov 2, 2026, 12:00\sPM/)).toBeTruthy()
  })

  it('draws the hits bar as a share of the busiest flow of the page', async () => {
    setup([sug('s1', { hits: 200 }), sug('s2', { hits: 50, dst_ip: '10.0.0.8', src_zone_id: 'zd', dst_zone_id: 'zw' })])
    const busy = (await row('web to db')).querySelector('[data-share]') as HTMLElement
    const quiet = (await row('db to web')).querySelector('[data-share]') as HTMLElement
    expect(busy.style.width).toBe('100%')
    expect(quiet.style.width).toBe('25%')
  })

  it('colours the source dot with the zone colour, red for a source in no zone', async () => {
    setup([sug('s1'), unknownSource])
    expect((await row('web to db')).querySelector('[data-source-dot]')?.getAttribute('data-source-dot')).toBe('#3b82f6')
    expect((await row('192.168.1.50 to db')).querySelector('[data-source-dot]')?.getAttribute('data-source-dot')).toBe('error.main')
  })

  it('shows a blocked flow with its own glyph and a blue status', async () => {
    setup([sug('b1', { kind: 'blocked' })])
    const line = await row('web to db')
    expect(line.querySelector('i.ri-forbid-line')).toBeTruthy()
    expect(within(line).getByText('Blocked').closest('.MuiChip-root')?.className).toMatch(/colorInfo/)
  })

  it('shows an unknown source as an IP with the accept as CIDR action, and Accept disabled', async () => {
    setup([unknownSource])
    const line = await row('192.168.1.50 to db')
    expect(within(line).getByText('192.168.1.50')).toBeTruthy()
    const accept = within(line).getByRole('button', { name: 'Accept' }) as HTMLButtonElement
    expect(accept.disabled).toBe(true)
    const cidr = within(line).getByRole('button', { name: 'As CIDR' }) as HTMLButtonElement
    expect(cidr.disabled).toBe(false)

    fireEvent.click(cidr)
    await waitFor(() => expect(calls('POST /suggestions/resolve')).toHaveLength(1))
    expect(body(calls('POST /suggestions/resolve')[0][1])).toEqual({ version: 3, ids: ['u1'], action: 'accept_cidr' })
  })

  it('disables the accept as CIDR when the source has no IP', async () => {
    setup([sug('s1')])
    const line = await row('web to db')
    expect((within(line).getByRole('button', { name: 'As CIDR' }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(line).getByRole('button', { name: 'Accept' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('opens a flow in a centred dialog: summary, 24-hour traffic between its zones, recent occurrences, actions', async () => {
    const from = '2026-11-01T13:00:00Z'
    mock.routes['GET /traffic*'] = () => reply(200, {
      step: 3600, from, to: '2026-11-02T13:00:00Z',
      buckets: [
        { at: '2026-11-02T12:00:00Z', zone: 'db', src_zone: 'web', verdict: 'would_block', hits: 7 },
        { at: '2026-11-02T11:00:00Z', zone: 'db', src_zone: 'web', verdict: 'would_block', hits: 3 },
        { at: '2026-11-02T11:00:00Z', zone: 'db', src_zone: 'web', verdict: 'blocked', hits: 50 },
        { at: '2026-11-02T11:00:00Z', zone: 'web', src_zone: 'db', verdict: 'would_block', hits: 90 },
      ],
    })
    const ev = (seq: number, over: Record<string, unknown> = {}) => ({
      seq, ts: '2026-11-02T12:00:00Z', node: 'pve1', vmid: 101, type: 'lxc', guest: 'db-1', zone: 'db', src_zone: 'web',
      src_ip: '10.0.0.5', dst_ip: '10.0.0.9', proto: 'tcp', dport: 443, verdict: 'would_block', ...over,
    })
    mock.routes['GET /events*'] = () => reply(200, { events: [ev(3), ev(2, { dport: 4430 }), ev(1, { src_zone: 'app' })], truncated: false, oldest: null })
    setup([sug('s1')])
    const line = await row('web to db')
    expect(within(line).queryByRole('button', { name: 'Show details' })).toBeNull()
    fireEvent.click(within(line).getByRole('button', { name: 'Details of the flow from web to db' }))

    const dialog = await screen.findByRole('dialog', { name: 'web → db · HTTPS' })
    expect(within(dialog).getByText('Would be blocked')).toBeTruthy()
    const summary = within(dialog).getByRole('region', { name: 'Summary' })
    expect(within(summary).getByText(/Nov 1, 2026, 10:00\sAM/)).toBeTruthy()
    expect(within(summary).getByText(/Nov 2, 2026, 12:00\sPM/)).toBeTruthy()
    expect(within(summary).getByText('Unknown → 10.0.0.9')).toBeTruthy()
    expect(within(dialog).getByText(/one sample pair of addresses per observed flow/)).toBeTruthy()

    // The bars: web into db with the flow's verdict only (7 + 3), the other verdict and direction left out.
    expect(await within(dialog).findByRole('img', { name: 'Traffic over the last 24 hours: 10 hits' })).toBeTruthy()
    expect(within(dialog).getByText(/Every service from web into db/)).toBeTruthy()

    // Recent occurrences: the event of the flow only (same port, same source zone), with the guest it reached.
    const recent = await within(dialog).findByRole('table', { name: 'Recent occurrences' })
    await waitFor(() => expect(within(recent).getAllByRole('row')).toHaveLength(2))
    expect(within(recent).getByText('db-1 (101) · 10.0.0.9')).toBeTruthy()
    expect(within(recent).getByText('pve1')).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(calls('POST /suggestions/resolve')).toHaveLength(1))
    expect(body(calls('POST /suggestions/resolve')[0][1] as RequestInit)).toMatchObject({ ids: ['s1'], action: 'dismiss' })
  })

  it('shows the flow of a zone-less source with its address and no accept into a zone', async () => {
    mock.routes['GET /traffic*'] = () => reply(200, { step: 3600, from: '2026-11-01T13:00:00Z', to: '2026-11-02T13:00:00Z', buckets: [] })
    mock.routes['GET /events*'] = () => reply(200, { events: [], truncated: false, oldest: null })
    setup([unknownSource])
    fireEvent.click(within(await row('192.168.1.50 to db')).getByRole('button', { name: 'Details of the flow from 192.168.1.50 to db' }))
    const dialog = await screen.findByRole('dialog', { name: '192.168.1.50 → db · HTTPS' })
    expect(within(dialog).getByText('192.168.1.50 → 10.0.0.9')).toBeTruthy()
    expect(await within(dialog).findByText(/Every source outside the zones into db/)).toBeTruthy()
    expect(await within(dialog).findByText(/None in the engine's memory/)).toBeTruthy()
    expect((within(dialog).getByRole('button', { name: 'Accept' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Close' }).at(-1)!)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('puts the three filters on the row of the sub-tabs, before Check now', async () => {
    setup([sug('s1')])
    await row('web to db')
    const slot = await screen.findByTestId('microseg-actions-slot')
    const filters = within(slot).getByTestId('observation-filters')
    for (const name of ['Type', 'Status', 'Zone']) expect(within(filters).getByRole('combobox', { name })).toBeTruthy()
    const check = screen.getByRole('button', { name: /Check now/ })
    expect(filters.compareDocumentPosition(check) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('says there is nothing to show', async () => {
    setup([])
    expect(await screen.findByText('No observed flow matches these filters.')).toBeTruthy()
  })

  it('shows the sampling notice with a link that opens the settings of the tab', async () => {
    setup([])
    fireEvent.mouseOver(await screen.findByRole('button', { name: 'About the hit counts' }))
    expect(await screen.findByText(/at most one line per second per chain by default/)).toBeTruthy()
    const link = screen.getByRole('button', { name: 'Open settings' }) as HTMLButtonElement
    expect(link.disabled).toBe(false)
    fireEvent.click(link)
    expect(await screen.findByRole('dialog', { name: 'Micro-segmentation settings' })).toBeTruthy()
  })
})

describe('grouping by destination zone', () => {
  const toDb = [sug('d1', { hits: 24_000 }), sug('d2', { hits: 594, dst_ip: '10.0.0.8' })]
  const toWeb = [sug('w1', { src_zone_id: 'zd', dst_zone_id: 'zw', hits: 30_000, dst_ip: '10.0.0.20' })]
  const toNowhere = [sug('n1', { dst_zone_id: '', dst_ip: '203.0.113.9', hits: 90_000 })]
  const headers = () => screen.getAllByRole('row').filter(r => r.hasAttribute('data-group'))
  const groupButton = (zone: string) => screen.getByRole('button', { name: new RegExp(`^${zone} · `) })

  it('puts a header row per destination zone, the busiest first, the unknown destination last', async () => {
    setup([...toWeb, ...toDb, ...toNowhere])
    await findFlowRows()
    expect(headers().map(h => h.textContent)).toEqual([
      'web · 1 observed flow · 30,000 hits',
      'db · 2 observed flows · 24,594 hits',
      'Unknown destination · 1 observed flow · 90,000 hits',
    ])
    expect(flowRows().map(r => r.getAttribute('data-suggestion'))).toEqual(['w1', 'd1', 'd2', 'n1'])
  })

  it('folds a zone from its whole header row, keeps it folded in this browser, and unfolds it', async () => {
    setup([...toDb, ...toWeb])
    await findFlowRows()
    const header = groupButton('db')
    expect(header.tagName).toBe('BUTTON')
    expect(header.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(header)
    expect(flowRows().map(r => r.getAttribute('data-suggestion'))).toEqual(['w1'])
    expect(window.localStorage.getItem('microseg.observation.collapsed')).toBe('["zd"]')
    expect(groupButton('db').getAttribute('aria-expanded')).toBe('false')
    cleanup()

    setup([...toDb, ...toWeb])
    await findFlowRows()
    expect(groupButton('db').getAttribute('aria-expanded')).toBe('false')
    expect(flowRows().map(r => r.getAttribute('data-suggestion'))).toEqual(['w1'])
    fireEvent.click(groupButton('db'))
    expect(flowRows()).toHaveLength(3)
    expect(window.localStorage.getItem('microseg.observation.collapsed')).toBe('[]')
  })

  it('selects only the flows of unfolded zones, and the bulk bar counts what is shown', async () => {
    setup([...toDb, ...toWeb])
    await findFlowRows()
    fireEvent.click(groupButton('db'))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all shown on this page' }))
    const bar = screen.getByRole('toolbar', { name: 'Selected flows' })
    expect(within(bar).getByText('1 selected')).toBeTruthy()
    fireEvent.click(within(bar).getByRole('button', { name: 'Dismiss selected' }))
    await waitFor(() => expect(calls('POST /suggestions/resolve')).toHaveLength(1))
    expect(body(calls('POST /suggestions/resolve')[0][1])).toEqual({ version: 3, ids: ['w1'], action: 'dismiss' })
  })

  it('drops the flows of a zone from the selection when it is folded', async () => {
    setup([...toDb, ...toWeb])
    await findFlowRows()
    const all = screen.getByRole('checkbox', { name: 'Select all shown on this page' }) as HTMLInputElement
    fireEvent.click(all)
    expect(screen.getByText('3 selected')).toBeTruthy()
    fireEvent.click(groupButton('db'))
    expect(screen.getByText('1 selected')).toBeTruthy()
    expect(all.checked).toBe(true)
    fireEvent.click(groupButton('db'))
    expect(screen.getByText('1 selected')).toBeTruthy()
    expect(all.getAttribute('data-indeterminate')).toBe('true')
  })

  it('reads a broken stored value as no zone folded', async () => {
    setup([...toDb])
    window.localStorage.setItem('microseg.observation.collapsed', '{broken')
    await findFlowRows()
    expect(flowRows()).toHaveLength(2)
  })

  it('says the grouping covers the page when the next page goes on, naming its first zone', async () => {
    const full = Array.from({ length: 25 }, (_, i) => sug(`p${i}`, { dst_ip: `10.1.0.${i}` }))
    setup([...full, sug('next', { src_zone_id: 'zd', dst_zone_id: 'zw' })])
    expect(await screen.findByText('Flows are grouped within this page: the next page goes on, starting with web.')).toBeTruthy()
  })

  it('has no such caption on the last page', async () => {
    setup(toDb)
    await findFlowRows()
    expect(screen.queryByText(/grouped within this page/)).toBeNull()
  })
})

describe('legend and labelled actions', () => {
  const tip = async (button: HTMLElement) => {
    fireEvent.mouseOver(button.parentElement as HTMLElement)
    return (await screen.findByRole('tooltip')).textContent
  }

  it('explains the marks of the table on one legend row above it', async () => {
    setup([sug('s1')])
    const legend = await screen.findByRole('list', { name: 'Legend' })
    const items = within(legend).getAllByRole('listitem')
    expect(items.map(i => i.textContent)).toEqual(['Seen in observation, would be blocked', 'Actually blocked', 'Source zone colour', 'Unknown source'])
    expect(items[0].querySelector('i.ri-eye-line')).toBeTruthy()
    expect(items[1].querySelector('i.ri-forbid-line')).toBeTruthy()
    expect(items[3].querySelector('[data-legend-dot]')?.getAttribute('data-legend-dot')).toBe('error.main')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows the three actions of a row as coloured icons named by the action, the tooltip saying what each does', async () => {
    setup([sug('s1', { src_ip: '10.0.0.5' })])
    const line = await row('web to db')
    const icons = { Accept: ['ri-checkbox-circle-line', 'Success'], 'As CIDR': ['ri-global-line', 'Info'], Dismiss: ['ri-close-circle-line', 'Error'] }
    for (const [name, [icon, colour]] of Object.entries(icons)) {
      const button = within(line).getByRole('button', { name })
      expect(button.textContent).toBe('')
      expect(button.querySelector(`i.${icon}`)).toBeTruthy()
      expect(button.className).toContain(`MuiIconButton-color${colour}`)
    }
    expect(await tip(within(line).getByRole('button', { name: 'Accept' }))).toBe('Accept: Creates the flow web \u2192 db HTTPS (tcp/443) in the draft.')
  })

  it('explains As CIDR with the IP of the source', async () => {
    setup([unknownSource])
    const line = await row('192.168.1.50 to db')
    expect(await tip(within(line).getByRole('button', { name: 'As CIDR' }))).toMatch(/^As CIDR: .*source 192\.168\.1\.50 as an address range: needed when the source is an unknown IP/)
  })

  it('says why Accept is disabled for a source in no zone', async () => {
    setup([unknownSource])
    const accept = within(await row('192.168.1.50 to db')).getByRole('button', { name: 'Accept' }) as HTMLButtonElement
    expect(accept.disabled).toBe(true)
    expect(await tip(accept)).toBe('Accept: Unknown source: use As CIDR')
  })

  it('lets the keyboard reach the tooltip of the source name', async () => {
    setup([sug('s1')])
    expect(within(await row('web to db')).getByText('web').getAttribute('tabindex')).toBe('0')
  })

  it('tells what Dismiss does', async () => {
    setup([sug('s1')])
    expect(await tip(within(await row('web to db')).getByRole('button', { name: 'Dismiss' }))).toBe('Dismiss: Hides this suggestion for this pair.')
  })

  it('shows the bulk bar with the count and the labelled actions once flows are checked', async () => {
    setup([sug('s1'), sug('s2', { dst_ip: '10.0.0.8' })])
    await findFlowRows()
    expect(screen.queryByRole('toolbar', { name: 'Selected flows' })).toBeNull()
    fireEvent.click(within(flowRows()[0]).getByRole('checkbox'))
    const bar = screen.getByRole('toolbar', { name: 'Selected flows' })
    expect(within(bar).getByText('1 selected')).toBeTruthy()
    expect(within(bar).getAllByRole('button').map(b => b.textContent)).toEqual(['Accept', 'As CIDR', 'Dismiss'])
    fireEvent.click(within(bar).getByRole('button', { name: 'Accept selected' }))
    await waitFor(() => expect(calls('POST /suggestions/resolve')).toHaveLength(1))
    expect(body(calls('POST /suggestions/resolve')[0][1])).toEqual({ version: 3, ids: ['s1'], action: 'accept' })
  })
})

describe('unit actions', () => {
  it('accepts a flow of a zone and reloads the list and the draft', async () => {
    setup([sug('s1')])
    const line = await row('web to db')
    const before = calls('GET /policy').length
    fireEvent.click(within(line).getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(calls('POST /suggestions/resolve')).toHaveLength(1))
    expect(body(calls('POST /suggestions/resolve')[0][1])).toEqual({ version: 3, ids: ['s1'], action: 'accept' })
    await waitFor(() => expect(calls('GET /policy').length).toBeGreaterThan(before))
    await waitFor(() => expect(listCalls().length).toBeGreaterThan(1))
    expect(await screen.findByText('1 flow accepted into the draft')).toBeTruthy()
  })

  it('dismisses a flow', async () => {
    setup([sug('s1')])
    fireEvent.click(within(await row('web to db')).getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(calls('POST /suggestions/resolve')).toHaveLength(1))
    expect(body(calls('POST /suggestions/resolve')[0][1])).toEqual({ version: 3, ids: ['s1'], action: 'dismiss' })
  })

  it('shows the server message of a 400 INVALID', async () => {
    setup([sug('s1')])
    mock.routes['POST /suggestions/resolve'] = () => reply(400, { code: 'INVALID', error: 'suggestion s1 has no source zone' })
    fireEvent.click(within(await row('web to db')).getByRole('button', { name: 'Accept' }))
    expect(await screen.findByText(/suggestion s1 has no source zone/)).toBeTruthy()
  })

  it('reloads on a 409 and keeps the selection', async () => {
    setup([sug('s1'), sug('s2', { src_zone_id: 'zd', dst_zone_id: 'zw' })])
    mock.routes['POST /suggestions/resolve'] = () => reply(409, { code: 'VERSION_CONFLICT', error: 'x' })
    await row('web to db')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all shown on this page' }))
    expect(screen.getByText('2 selected')).toBeTruthy()
    const before = calls('GET /policy').length
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss selected' }))
    expect(await screen.findByText(/changed elsewhere and was reloaded/)).toBeTruthy()
    await waitFor(() => expect(calls('GET /policy').length).toBeGreaterThan(before))
    expect(screen.getByText('2 selected')).toBeTruthy()
  })
})

describe('bulk actions', () => {
  const three = [sug('s1'), sug('s2', { dst_ip: '10.0.0.8' }), sug('s3', { dst_ip: '10.0.0.7' })]

  it('accepts three suggestions at once and reloads', async () => {
    setup(three)
    await findFlowRows()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all shown on this page' }))
    expect(screen.getByText('3 selected')).toBeTruthy()
    const before = listCalls().length
    fireEvent.click(screen.getByRole('button', { name: 'Accept selected' }))
    await waitFor(() => expect(calls('POST /suggestions/resolve')).toHaveLength(1))
    expect(body(calls('POST /suggestions/resolve')[0][1])).toEqual({ version: 3, ids: ['s1', 's2', 's3'], action: 'accept' })
    await waitFor(() => expect(listCalls().length).toBeGreaterThan(before))
    await waitFor(() => expect(screen.queryByText('3 selected')).toBeNull())
  })

  it('has a three-state select-all over the current page', async () => {
    setup(three)
    await findFlowRows()
    const all = screen.getByRole('checkbox', { name: 'Select all shown on this page' }) as HTMLInputElement
    const indeterminate = () => all.getAttribute('data-indeterminate') === 'true'
    expect(all.checked).toBe(false)
    expect(indeterminate()).toBe(false)

    const lines = flowRows()
    fireEvent.click(within(lines[0]).getByRole('checkbox'))
    expect(all.checked).toBe(false)
    expect(indeterminate()).toBe(true)

    fireEvent.click(all)
    expect(all.checked).toBe(true)
    expect(indeterminate()).toBe(false)

    fireEvent.click(all)
    expect(all.checked).toBe(false)
    expect(screen.queryByText(/ selected$/)).toBeNull()
  })

  it('disables the bulk Accept while a selected flow has no source zone, and offers the CIDR', async () => {
    setup([sug('s1'), unknownSource])
    await findFlowRows()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all shown on this page' }))
    expect((screen.getByRole('button', { name: 'Accept selected' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Accept selected as CIDR' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Dismiss selected' }) as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(within(screen.getByRole('row', { name: 'web to db' })).getByRole('checkbox'))
    expect((screen.getByRole('button', { name: 'Accept selected as CIDR' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Accept selected as CIDR' }))
    await waitFor(() => expect(calls('POST /suggestions/resolve')).toHaveLength(1))
    expect(body(calls('POST /suggestions/resolve')[0][1])).toEqual({ version: 3, ids: ['u1'], action: 'accept_cidr' })
  })

  it('has no bulk bar until something is selected', async () => {
    setup(three)
    await findFlowRows()
    expect(screen.queryByRole('button', { name: 'Accept selected' })).toBeNull()
  })
})

describe('server side filters and pagination', () => {
  it('asks the server for pending flows by default, 25 per page (one more to know there is a next page)', async () => {
    setup([sug('s1')])
    await row('web to db')
    expect(listCalls()).toContain('/suggestions?limit=26&status=pending')
  })

  it('filters by type, status and zone on the server and goes back to the first page', async () => {
    setup([sug('s1')])
    mock.routes['GET /suggestions?kind=blocked&limit=26&status=pending'] = () => reply(200, { suggestions: [sug('b1', { kind: 'blocked' })], limit: 26, offset: 0 })
    mock.routes['GET /suggestions?kind=blocked&limit=26&status=dismissed'] = () => reply(200, { suggestions: [], limit: 26, offset: 0 })
    mock.routes['GET /suggestions?kind=blocked&limit=26&status=dismissed&zone=zd'] = () => reply(200, { suggestions: [], limit: 26, offset: 0 })
    await row('web to db')

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Type' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Blocked' }))
    await waitFor(() => expect(listCalls()).toContain('/suggestions?kind=blocked&limit=26&status=pending'))

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Status' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Dismissed' }))
    await waitFor(() => expect(listCalls()).toContain('/suggestions?kind=blocked&limit=26&status=dismissed'))

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Zone' }))
    fireEvent.click(await screen.findByRole('option', { name: 'db' }))
    await waitFor(() => expect(listCalls()).toContain('/suggestions?kind=blocked&limit=26&status=dismissed&zone=zd'))
  })

  it('pages with limit and offset, and stops at the last page', async () => {
    const page = (from: number, n: number) => Array.from({ length: n }, (_, i) => sug(`p${from + i}`, { dst_ip: `10.1.0.${from + i}` }))
    setup(page(0, 26))
    mock.routes['GET /suggestions?limit=26&offset=25&status=pending'] = () => reply(200, { suggestions: page(25, 3), limit: 26, offset: 25 })
    await findFlowRows()
    expect(flowRows()).toHaveLength(25)
    expect(screen.getByText('Page 1')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Previous page' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(screen.getByText('Page 2')).toBeTruthy())
    await waitFor(() => expect(flowRows()).toHaveLength(3))
    expect(listCalls()).toContain('/suggestions?limit=26&offset=25&status=pending')
    expect((screen.getByRole('button', { name: 'Next page' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }))
    await waitFor(() => expect(screen.getByText('Page 1')).toBeTruthy())
  })

  it('goes back one page when the last page has nothing left to show', async () => {
    const full = Array.from({ length: 26 }, (_, i) => sug(`p${i}`, { dst_ip: `10.1.0.${i}` }))
    setup(full)
    let resolved = false
    mock.routes['GET /suggestions?limit=26&offset=25&status=pending'] = () => reply(200, { suggestions: resolved ? [] : [sug('p25')], limit: 26, offset: 25 })
    mock.routes['POST /suggestions/resolve'] = () => { resolved = true; return reply(200, { version: 4 }) }
    await findFlowRows()
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(screen.getByText('Page 2')).toBeTruthy())
    await waitFor(() => expect(flowRows()).toHaveLength(1))

    fireEvent.click(within(flowRows()[0]).getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(screen.getByText('Page 1')).toBeTruthy())
    await waitFor(() => expect(flowRows()).toHaveLength(25))
    expect(screen.queryByText('No observed flow matches these filters.')).toBeNull()
  })

  it('stays on the page when the rows resolved are not the last of it', async () => {
    const full = Array.from({ length: 26 }, (_, i) => sug(`p${i}`, { dst_ip: `10.1.0.${i}` }))
    setup(full)
    mock.routes['GET /suggestions?limit=26&offset=25&status=pending'] = () => reply(200, { suggestions: [sug('p25'), sug('p26', { dst_ip: '10.1.0.99' })], limit: 26, offset: 25 })
    await findFlowRows()
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(flowRows()).toHaveLength(2))
    fireEvent.click(within(flowRows()[0]).getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(calls('POST /suggestions/resolve')).toHaveLength(1))
    await waitFor(() => expect(screen.getByText('1 flow dismissed')).toBeTruthy())
    expect(screen.getByText('Page 2')).toBeTruthy()
  })

  it('drops the selection when the page changes', async () => {
    const full = Array.from({ length: 26 }, (_, i) => sug(`p${i}`, { dst_ip: `10.1.0.${i}` }))
    setup(full)
    mock.routes['GET /suggestions?limit=26&offset=25&status=pending'] = () => reply(200, { suggestions: [sug('p25')], limit: 26, offset: 25 })
    await findFlowRows()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all shown on this page' }))
    expect(screen.getByText('25 selected')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(screen.getByText('Page 2')).toBeTruthy())
    expect(screen.queryByText('25 selected')).toBeNull()
  })

  it('shows the error of a failed read with a retry', async () => {
    setup([])
    mock.routes[ROUTE] = () => reply(503, { code: 'NOT_LEADER', error: 'x' })
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy()
  })
})

describe('settings link', () => {
  it('is wired through the onOpenSettings prop of the panel', async () => {
    const onOpenSettings = vi.fn()
    mock.routes[ROUTE] = () => reply(200, { suggestions: [], limit: 26, offset: 0 })
    renderWithProviders(
      <ObservationPanel
        connectionId='c1'
        policy={policy({ zones: [web, db] })}
        reloadPolicy={async () => undefined}
        goToSubTab={() => undefined}
        onOpenPlan={() => undefined}
        startRun={() => undefined}
        onOpenSettings={onOpenSettings}
      />,
    )
    const link = await screen.findByRole('button', { name: 'Open settings' })
    expect((link as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(link)
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
  })

  it('is disabled while the panel has no way to open the settings', async () => {
    mock.routes[ROUTE] = () => reply(200, { suggestions: [], limit: 26, offset: 0 })
    renderWithProviders(
      <ObservationPanel
        connectionId='c1'
        policy={policy({ zones: [web, db] })}
        reloadPolicy={async () => undefined}
        goToSubTab={() => undefined}
        onOpenPlan={() => undefined}
        startRun={() => undefined}
      />,
    )
    expect(((await screen.findByRole('button', { name: 'Open settings' })) as HTMLButtonElement).disabled).toBe(true)
  })
})
