/**
 * Overview sub-tab, the panels of the map (UA56): as tall as the map, their content in foldable sections remembered
 * per browser; the zone panel charts the zone's flows inbound or outbound (the Dashboard's chart filtered on it), its
 * top sources or destinations, its drifts in a header chip leading to them, NIC firewall off on its members, and
 * resolves its pending suggestions through the draft as the map's flow panel does; the guest panel charts the guest's
 * events of the orchestrator's memory.
 */

import { describe, expect, it, vi } from 'vitest'
import { within } from '@testing-library/react'

import RBACContext, { type RBACContextValue } from '@/contexts/RBACContext'

import { screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'

// The test kit first: it stands in for @xyflow/react before the tab loads it.
import { GUESTS_ROUTE, REVISION_HEAD, calls, mock, policy, renderTab, reply } from './microsegTestKit'
import MicrosegTab from './MicrosegTab'
import { PANEL_SECTIONS_KEY } from './PanelSection'
import { body, db, installFreshMocks, vm, web } from './policyTestKit'
import { SUGGESTIONS, node, setup, wouldBlock } from './zoneMapTestKit'

installFreshMocks()

const EVENTS_OF_DB = 'GET /events?limit=500&zone=db'

let seq = 900
const event = (src_zone: string, over: Record<string, unknown> = {}) => ({
  seq: seq--, ts: new Date(Date.now() - 60_000).toISOString(), node: 'pve1', vmid: 101, type: 'qemu', guest: 'db1', zone: 'db', src_zone,
  src_ip: src_zone ? '10.0.0.5' : '203.0.113.9', dst_ip: '10.0.0.2', proto: 'tcp', dport: 5432, verdict: 'would_block', ...over,
})

async function openDb() {
  fireEvent.click(await node('zone:zd'))
  return screen.findByRole('complementary', { name: 'Zone db' })
}

const section = (panel: HTMLElement, name: string) => within(panel).getByRole('region', { name })

describe('zone panel sections', () => {
  it('splits the panel in foldable sections with their counts, the body scrolling under a fixed header', async () => {
    setup({ suggestions: [wouldBlock('s1')], vms: [vm(101, 'db1', ['zone-db'])] })
    const panel = await openDb()

    const titles = [...panel.querySelectorAll('section[data-section]')].map(s => s.getAttribute('aria-label'))
    expect(titles).toEqual(['Observed traffic', 'Top sources and destinations', 'Pending suggestions', 'Members', 'Incoming flows', 'Outgoing flows'])
    await waitFor(() => expect(within(panel).getByTestId('section-zone.members-count').textContent).toBe('1'))
    expect(within(panel).getByTestId('section-zone.suggestions-count').textContent).toBe('1')
    expect(within(panel).getByTestId('panel-body')).toBeTruthy()
  })

  it('folds a section, and keeps it folded when the panel opens again', async () => {
    setup({ vms: [vm(101, 'db1', ['zone-db'])] })
    let panel = await openDb()
    expect(await within(panel).findByText('db1')).toBeTruthy()

    fireEvent.click(within(panel).getByTestId('section-zone.members'))
    await waitFor(() => expect(within(panel).queryByText('db1')).toBeNull())
    expect(JSON.parse(window.localStorage.getItem(PANEL_SECTIONS_KEY) ?? '[]')).toEqual(['zone.members'])

    fireEvent.click(within(panel).getByRole('button', { name: 'Close' }))
    panel = await openDb()
    expect(within(panel).getByTestId('section-zone.members').getAttribute('aria-expanded')).toBe('false')
    expect(within(panel).queryByText('db1')).toBeNull()
    fireEvent.click(within(panel).getByTestId('section-zone.members'))
    expect(await within(panel).findByText('db1')).toBeTruthy()
    expect(JSON.parse(window.localStorage.getItem(PANEL_SECTIONS_KEY) ?? '[]')).toEqual([])
  })
})

describe('zone panel: drifts', () => {
  it('says the zone\'s drifts in a header chip only when there are some, opening the Drifts sub-tab filtered on the zone', async () => {
    mock.routes['GET /drifts'] = () => reply(200, {
      computed: true,
      drifts: [
        { kind: 'nic_firewall_off', guest: { node: 'pve1', type: 'qemu', vmid: 101 } },
        { kind: 'ipset_out_of_sync', object: 'pcz-db', detail: { zone: 'zd' } },
        { kind: 'nic_firewall_off', guest: { node: 'pve1', type: 'qemu', vmid: 300 } },
      ],
    })
    setup({ vms: [vm(101, 'db1', ['zone-db']), vm(102, 'db2', ['zone-db'], { status: 'stopped' }), vm(300, 'other', [])] })
    const panel = await openDb()

    expect((await within(panel).findByTestId('zone-drifts-chip')).textContent).toBe('2 drifts')
    // The member the engine found with its NIC firewall off says so; the stopped one keeps its status dot.
    const db1 = await within(panel).findByRole('listitem', { name: 'db1' })
    expect(within(db1).getByTestId('member-firewall-off')).toBeTruthy()
    expect(within(within(panel).getByRole('listitem', { name: 'db2' })).queryByTestId('member-firewall-off')).toBeNull()
    expect(calls('GET /drifts').length).toBeGreaterThan(0)

    fireEvent.click(within(panel).getByTestId('zone-drifts-chip'))
    const filter = await screen.findByTestId('drifts-zone-filter')
    expect(filter.textContent).toContain('Zone db only')
    fireEvent.click(within(filter).getByRole('button', { name: 'Show every zone' }))
    await waitFor(() => expect(screen.queryByTestId('drifts-zone-filter')).toBeNull())
  })

  it('shows no drift chip without drifts', async () => {
    mock.routes['GET /drifts'] = () => reply(200, { computed: true, drifts: [] })
    setup()
    const panel = await openDb()
    await waitFor(() => expect(calls('GET /drifts').length).toBeGreaterThan(0))
    expect(within(panel).queryByTestId('zone-drifts-chip')).toBeNull()
  })
})

describe('zone panel: Observed traffic and Top sources', () => {
  it('charts the events logged in the zone (asked with zone=), stacked by source zone, and ranks its sources with their share', async () => {
    mock.routes[EVENTS_OF_DB] = () => reply(200, {
      events: [event('web'), event('web'), event('web', { verdict: 'blocked' }), event('')], truncated: false, oldest: null,
    })
    setup()
    const panel = await openDb()
    fireEvent.click(within(panel).getByTestId('direction-in'))

    const traffic = section(panel, 'Observed traffic')
    await waitFor(() => expect(within(traffic).getAllByTestId(/^area-/).map(a => a.getAttribute('data-testid'))).toEqual(['area-zone:zw', 'area-external']))
    expect(calls(EVENTS_OF_DB).length).toBeGreaterThan(0)
    expect(within(traffic).getByTestId('traffic-summary').textContent).toBe('4 hits · top source web (75%) · 3 would be blocked, 1 blocked')
    expect(within(traffic).getByTestId('timeline-legend').textContent).toContain('web')

    const rows = within(section(panel, 'Top sources')).getAllByRole('listitem')
    expect(rows.map(r => r.getAttribute('data-source'))).toEqual(['zone:zw', 'external'])
    expect(rows[0].textContent).toContain('75%')
    expect(rows[1].textContent).toContain('Unknown / External')
    expect(rows[1].textContent).toContain('25%')
  })
})

describe('zone panel: Pending suggestions', () => {
  it('lists the learned flows towards the zone and accepts one through the draft', async () => {
    mock.routes['POST /suggestions/resolve'] = () => reply(200, { version: 4 })
    setup({ suggestions: [wouldBlock('s1', { hits: 9 }), wouldBlock('s2', { dst_zone_id: 'zw', src_zone_id: 'zd' })] })
    const panel = await openDb()
    const pending = section(panel, 'Pending suggestions')

    const line = within(pending).getByRole('listitem', { name: 'web' })
    expect(within(pending).getAllByRole('listitem')).toHaveLength(1)
    fireEvent.click(within(line).getByRole('button', { name: 'Accept' }))

    await waitFor(() => expect(calls('POST /suggestions/resolve')).toHaveLength(1))
    expect(body(calls('POST /suggestions/resolve')[0][1] as RequestInit)).toEqual({ version: 3, ids: ['s1'], action: 'accept' })
  })
})

describe('zone panel: expanded in a dialog', () => {
  it('opens the traffic, the data and the logs of the zone in a centred dialog with tabs', async () => {
    mock.routes[EVENTS_OF_DB] = () => reply(200, { events: [event('web')], truncated: false, oldest: null })
    mock.routes['GET /events?limit=200'] = () => reply(200, {
      events: [event('web'), event('db', { zone: 'web', dst_ip: '172.30.99.43', dport: 9999 }), event('web', { zone: 'other', src_zone: 'x' })], truncated: false, oldest: null,
    })
    setup({ suggestions: [wouldBlock('s1')] })
    const panel = await openDb()
    fireEvent.click(within(panel).getByRole('button', { name: 'Expand' }))

    const dialog = await screen.findByRole('dialog', { name: 'Zone details · db' })
    expect(within(dialog).getAllByRole('tab').map(t => t.textContent)).toEqual(['Traffic', 'Data', 'Logs'])
    const title = within(dialog).getByRole('heading', { name: 'Zone details · db' })
    expect(title.parentElement?.textContent).toContain('Zone details · db')
    expect(within(title.parentElement as HTMLElement).getByRole('button', { name: 'Close' })).toBeTruthy()
    expect(within(dialog).getByTestId('direction-both').getAttribute('aria-pressed')).toBe('true')
    expect(await within(dialog).findByTestId('traffic-summary')).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('tab', { name: 'Data' }))
    const subs = within(dialog).getAllByRole('tab').map(t => t.textContent)
    expect(subs.slice(3)).toEqual(['Pending suggestions (1)', 'Members (0)', 'Incoming flows (0)', 'Outgoing flows (0)'])
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(1)
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Members (0)' }))
    expect(within(dialog).queryAllByRole('listitem')).toHaveLength(0)
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Incoming flows (0)' }))
    expect(within(dialog).getByRole('button', { name: 'New flow' })).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('tab', { name: 'Logs' }))
    await waitFor(() => expect(within(dialog).getAllByRole('row')).toHaveLength(3))
    expect(within(dialog).getAllByRole('columnheader').map(c => c.textContent)).toEqual(['Time', 'Direction', 'Verdict', 'Source', 'Destination', 'Service', 'Node'])
    expect(within(dialog).getByText('172.30.99.43')).toBeTruthy()
    expect(within(dialog).getAllByText('Would be blocked').length).toBeGreaterThan(0)
    expect(within(dialog).getAllByText('Inbound').length).toBeGreaterThan(0)
  })
})

describe('zone panel: outbound suggestions', () => {
  it('names the destination as the peer of an outbound row, and keeps the source for an inbound one', async () => {
    setup({ suggestions: [
      wouldBlock('o1', { direction: 'out', src_zone_id: 'zd', dst_zone_id: '', src_ip: '10.0.0.2', dst_ip: '172.30.99.43', dst_key: '172.30.99.43', proto: 'tcp', dport: 9999 }),
      wouldBlock('o2', { direction: 'out', src_zone_id: 'zd', dst_zone_id: 'zw', dst_key: 'zw', dst_ip: '' }),
      wouldBlock('o3', { direction: 'out', src_zone_id: 'zd', dst_zone_id: '', dst_ip: '', dst_key: '0.0.0.0/0' }),
      wouldBlock('i1'),
    ] })
    const panel = await openDb()
    const pending = section(panel, 'Pending suggestions')
    expect(within(pending).getAllByRole('listitem').map(l => l.getAttribute('aria-label')).sort()).toEqual(['172.30.99.43', 'Many destinations', 'web', 'web'])
    expect(within(pending).queryByRole('listitem', { name: 'db' })).toBeNull()
  })
})

describe('zone panel: direction', () => {
  it('charts outbound the flows the zone emitted, by destination zone, ranks its destinations, and does not remember the choice', async () => {
    // The ring has no source zone filter: outbound reads it whole and keeps the events from db.
    mock.routes['GET /events?limit=500'] = () => reply(200, {
      events: [event('db', { zone: 'web' }), event('db', { zone: 'web' }), event('web', { zone: 'db' })], truncated: false, oldest: null,
    })
    setup()
    let panel = await openDb()
    fireEvent.click(within(panel).getByTestId('direction-out'))

    const traffic = section(panel, 'Observed traffic')
    await waitFor(() => expect(within(traffic).getByTestId('traffic-summary').textContent).toBe('2 hits · top destination web (100%) · 2 would be blocked, 0 blocked'))
    fireEvent.mouseOver(within(traffic).getByTestId('traffic-summary'))
    expect((await screen.findByRole('tooltip')).textContent).toContain("Blocked: connections blocked by the destination zone (its inbound) or by this zone's outbound.")
    expect(within(traffic).getAllByTestId(/^area-/).map(a => a.getAttribute('data-testid'))).toEqual(['area-zone:zw'])
    expect(within(panel).getByRole('region', { name: 'Top destinations' })).toBeTruthy()

    fireEvent.click(within(panel).getByRole('button', { name: 'Close' }))
    panel = await openDb()
    expect(within(panel).getByTestId('direction-both').getAttribute('aria-pressed')).toBe('true')
    expect(within(panel).getByTestId('direction-out').getAttribute('aria-pressed')).toBe('false')
    expect(Object.keys(window.localStorage).some(k => /direction/i.test(k))).toBe(false)
  })

  it('reads the persisted history and not the ring while the history answers, one read for both directions', async () => {
    mock.routes['GET /traffic*'] = () => reply(200, {
      step: 300, from: new Date(Date.now() - 3_600_000).toISOString(), to: new Date(Date.now() + 300_000).toISOString(),
      buckets: [
        { at: new Date(Date.now() - 60_000).toISOString(), zone: 'db', src_zone: 'web', verdict: 'would_block', hits: 4 },
        { at: new Date(Date.now() - 60_000).toISOString(), zone: 'web', src_zone: 'db', verdict: 'blocked', hits: 6 },
      ],
    })
    setup()
    const panel = await openDb()
    const traffic = section(panel, 'Observed traffic')
    fireEvent.click(within(panel).getByTestId('direction-in'))

    await waitFor(() => expect(within(traffic).getByTestId('traffic-summary').textContent).toBe('4 hits · top source web (100%) · 4 would be blocked, 0 blocked'))
    fireEvent.click(within(panel).getByTestId('direction-out'))
    await waitFor(() => expect(within(traffic).getByTestId('traffic-summary').textContent).toBe('6 hits · top destination web (100%) · 0 would be blocked, 6 blocked'))
    expect(calls('GET /events?limit=500').length + calls(EVENTS_OF_DB).length).toBe(0)
  })
})

// The rows sit in the bucket of now, the last one the chart draws (the one a pointer at the far right reads).
const HISTORY = (buckets: { zone: string; src_zone: string; verdict: string; hits: number }[]) => () => reply(200, {
  step: 300, from: new Date(Date.now() - 3_600_000).toISOString(), to: new Date(Date.now() + 1000).toISOString(),
  buckets: buckets.map(b => ({ at: new Date(Math.floor(Date.now() / 300_000) * 300_000).toISOString(), ...b })),
})

describe('zone panel: both directions (the default)', () => {
  it('mirrors the chart: inbound by source zone above the baseline, outbound by destination zone below it', async () => {
    mock.routes['GET /traffic*'] = HISTORY([
      { zone: 'db', src_zone: 'web', verdict: 'would_block', hits: 4 },
      { zone: 'web', src_zone: 'db', verdict: 'blocked', hits: 2 },
    ])
    setup()
    const panel = await openDb()
    const traffic = section(panel, 'Observed traffic')

    expect(within(panel).getByTestId('direction-both').getAttribute('aria-pressed')).toBe('true')
    await waitFor(() => expect(within(traffic).getAllByTestId(/^area-/).map(a => a.getAttribute('data-testid'))).toEqual(['area-in:zone:zw', 'area-out:zone:zw']))
    expect(within(traffic).getByTestId('timeline-baseline')).toBeTruthy()
    expect(within(traffic).getByTestId('timeline-max-below').textContent).toBe('4')
    expect(within(traffic).getByTestId('traffic-summary').textContent).toBe('in 4 hits (top source web 100%) · out 2 hits (top destination web 100%)')
    expect(within(traffic).getByTestId('timeline-legend').textContent).toBe('↓ web↑ web')

    fireEvent.mouseMove(within(traffic).getByTestId('timeline-overlay'), { clientX: 10_000 })
    const tip = screen.getByTestId('timeline-tip')
    expect(tip.textContent).toContain('↓ Inbound · 4 events')
    expect(tip.textContent).toContain('↑ Outbound · 2 events')

    const top = within(panel).getByRole('region', { name: 'Top sources and destinations' })
    expect(within(top).getAllByRole('listitem').map(r => r.getAttribute('data-source'))).toEqual(['in:zone:zw', 'out:zone:zw'])
    expect(within(panel).getByTestId('section-zone.sources-count').textContent).toBe('2')
  })

  it('says one direction is empty while the other has traffic, with a way to it', async () => {
    mock.routes['GET /traffic*'] = HISTORY([{ zone: 'web', src_zone: 'db', verdict: 'blocked', hits: 7 }])
    setup()
    const panel = await openDb()
    const traffic = section(panel, 'Observed traffic')
    fireEvent.click(within(panel).getByTestId('direction-in'))

    const empty = await within(traffic).findByTestId('timeline-empty')
    expect(empty.textContent).toBe('No inbound traffic in this range · 7 hits outbound · Show outbound')
    fireEvent.click(within(traffic).getByTestId('timeline-empty-action'))
    await waitFor(() => expect(within(panel).getByTestId('direction-out').getAttribute('aria-pressed')).toBe('true'))
  })
})

describe('guest panel: Observed traffic', () => {
  it('charts the events the guest logged (its VMID) from the ring, without range chips', async () => {
    mock.routes['GET /events?limit=500'] = () => reply(200, {
      events: [event('web', { vmid: 101 }), event('web', { vmid: 101 }), event('', { vmid: 999 })], truncated: false, oldest: null,
    })
    window.localStorage.setItem('microseg.subTab', 'overview')
    setup({ vms: [vm(101, 'db1', ['zone-db'], { ips: ['10.0.0.2'] })] })
    const search = await screen.findByRole('combobox', { name: 'Target a VM' })
    search.focus()
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    fireEvent.change(search, { target: { value: 'db1' } })
    fireEvent.click(await screen.findByRole('option', { name: /^db1,/ }))
    const panel = await screen.findByRole('complementary', { name: 'Guest db1' })
    fireEvent.click(within(panel).getByTestId('direction-in'))

    const traffic = section(panel, 'Observed traffic')
    await waitFor(() => expect(within(traffic).getAllByTestId(/^area-/).map(a => a.getAttribute('data-testid'))).toEqual(['area-zone:zw']))
    expect(within(traffic).queryByTestId('timeline-range-wrap')).toBeNull()
    expect(within(traffic).getByTestId('timeline-caption').textContent).toMatch(/orchestrator memory/)
  })
})

describe('guest panel: nothing in memory', () => {
  it('says the memory holds nothing for the guest and offers no verdict to pick', async () => {
    mock.routes['GET /events?limit=500'] = () => reply(200, { events: [event('web', { vmid: 999 })], truncated: false, oldest: null })
    setup({ vms: [vm(101, 'db1', ['zone-db'], { ips: ['10.0.0.2'] })] })
    const search = await screen.findByRole('combobox', { name: 'Target a VM' })
    search.focus()
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    fireEvent.change(search, { target: { value: 'db1' } })
    fireEvent.click(await screen.findByRole('option', { name: /^db1,/ }))
    const traffic = section(await screen.findByRole('complementary', { name: 'Guest db1' }), 'Observed traffic')

    expect((await within(traffic).findByTestId('timeline-empty')).textContent).toBe('No observed event for this guest in the orchestrator memory (last ~2 h)')
    expect(within(traffic).queryByRole('combobox', { name: 'Verdict' })).toBeNull()
    expect(within(traffic).getByTestId('direction-in')).toBeTruthy()
  })
})

function rbac(grant: boolean): RBACContextValue {
  return {
    permissions: [], roles: [], isAdmin: false, scopeTypes: [], hiddenWidgets: [], loading: false,
    hasPermission: () => grant, hasAnyPermission: () => grant, hasAllPermissions: () => grant,
    hasPermissionOn: vi.fn(() => grant),
    refresh: () => undefined,
  }
}

describe('zone panel: read-only user', () => {
  it('shows the pending suggestions with their actions disabled', async () => {
    window.localStorage.setItem('microseg.subTab', 'overview')
    mock.routes['GET /policy'] = () => reply(200, policy({ zones: [web(), db()], last_revision: REVISION_HEAD }))
    mock.routes[`GET ${GUESTS_ROUTE}`] = () => reply(200, { data: { vms: [] } })
    mock.routes[SUGGESTIONS] = () => reply(200, { suggestions: [wouldBlock('s1')], limit: 200, offset: 0 })
    renderTab(<RBACContext.Provider value={rbac(false)}><MicrosegTab connectionId='c1' /></RBACContext.Provider>)
    const panel = await openDb()
    const line = within(section(panel, 'Pending suggestions')).getByRole('listitem', { name: 'web' })
    const actions = within(line).getAllByRole('button') as HTMLButtonElement[]
    expect(actions).toHaveLength(3)
    expect(actions.every(b => b.disabled)).toBe(true)
  })
})
