/**
 * Overview sub-tab, the panel of a pair (a cell of the matrix, a ribbon of the Sankey diagram, an edge of the map), laid
 * out as the zone panel: both ends and the pair's chips in the header, the traffic restricted to the pair, its pending
 * suggestions paged with the ways out of Observation, the flows declared between the two ends, and the same content in
 * a dialog with the pair's events.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { within } from '@testing-library/react'

import { screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'

import { calls, exception, mock, reply } from './microsegTestKit'
import { db, installFreshMocks, vm, web } from './policyTestKit'
import { flowOf, setup, wouldBlock } from './zoneMapTestKit'

installFreshMocks()
beforeEach(() => window.localStorage.setItem('microseg.map.view', 'matrix'))

const toOutside = flowOf('fo', { dst_zone_id: '', dst_cidr: '0.0.0.0/0', dport: '443' })
const observing = () => web({ egress_state: 'observe', egress_observe_since: new Date().toISOString() })
const cell = (from: string, to: string) => screen.getByRole('gridcell', { name: new RegExp(`^${from} to ${to}:`) })
const section = (panel: HTMLElement, name: string) => within(panel).getByRole('region', { name })

async function openCell(from: string, to: string) {
  await screen.findByRole('grid')
  await waitFor(() => expect(cell(from, to)).toBeTruthy())
  fireEvent.click(cell(from, to))
  return screen.findByRole('complementary', { name: `Flow ${from} to ${to}` })
}

let seq = 700
const event = (zone: string, src_zone: string, over: Record<string, unknown> = {}) => ({
  seq: seq--, ts: new Date(Date.now() - 60_000).toISOString(), node: 'pve1', vmid: 101, type: 'qemu', guest: 'g', zone, src_zone,
  src_ip: '10.0.0.5', dst_ip: '10.0.0.2', proto: 'tcp', dport: 5432, verdict: 'would_block', ...over,
})

describe('pair panel: header', () => {
  it('shows both zones with their shields, the status of the pair and the outbound state of the source zone', async () => {
    setup({ zones: [observing(), db()], flows: [flowOf('f1')], suggestions: [wouldBlock('s1')] })
    const panel = await openCell('web', 'db')
    const ends = within(panel).getByTestId('pair-ends')
    expect(ends.textContent).toBe('webdb')
    expect(ends.querySelectorAll('.ri-shield-fill')).toHaveLength(2)
    expect(ends.querySelector('.ri-arrow-right-line')).toBeTruthy()
    expect(within(panel).getByText('Unprotected')).toBeTruthy()
    expect(within(panel).getByText('Outbound: observing')).toBeTruthy()
    expect(within(panel).getByRole('button', { name: 'Expand' })).toBeTruthy()
    expect(within(panel).getByRole('button', { name: 'Close' })).toBeTruthy()
    expect(within(panel).getByRole('button', { name: 'Edit in Policy' })).toBeTruthy()
  })

  it('shows Outside with its icon, and no outbound chip from a zone that does not control it towards another zone', async () => {
    setup({ flows: [flowOf('f1'), toOutside] })
    const panel = await openCell('web', 'Outside')
    const ends = within(panel).getByTestId('pair-ends')
    expect(ends.textContent).toBe('webOutside')
    expect(ends.querySelector('.ri-cloud-line')).toBeTruthy()
    expect(within(panel).getByText('Allowed')).toBeTruthy()
    // Towards Outside the outbound state of the source zone always tells whether the flow applies.
    expect(within(panel).getByText('Outbound: not controlled')).toBeTruthy()

    fireEvent.click(within(panel).getByRole('button', { name: 'Close' }))
    const other = await openCell('web', 'db')
    expect(within(other).queryByText(/^Outbound:/)).toBeNull()
  })
})

describe('pair panel: observed traffic', () => {
  it('charts only the flows of the pair: inbound as the destination logged them, outbound as the source logged them', async () => {
    const at = new Date(Math.floor(Date.now() / 300_000) * 300_000).toISOString()
    mock.routes['GET /traffic*'] = () => reply(200, {
      step: 300, from: new Date(Date.now() - 3_600_000).toISOString(), to: new Date(Date.now() + 1000).toISOString(),
      buckets: [
        { at, zone: 'db', src_zone: 'web', verdict: 'would_block', hits: 4 },
        { at, zone: 'web', src_zone: 'db', direction: 'out', verdict: 'blocked', hits: 2 },
        { at, zone: 'db', src_zone: 'x', verdict: 'would_block', hits: 9 },
        { at, zone: 'web', src_zone: 'db', verdict: 'would_block', hits: 7 },
        { at, zone: 'db', src_zone: 'web', direction: 'out', verdict: 'would_block', hits: 5 },
      ],
    })
    setup({ flows: [flowOf('f1')] })
    const panel = await openCell('web', 'db')
    const traffic = section(panel, 'Observed traffic')
    expect(within(panel).getByTestId('direction-both').getAttribute('aria-pressed')).toBe('true')
    await waitFor(() => expect(within(traffic).getByTestId('traffic-summary').textContent).toBe('in 4 hits (top source web 100%) · out 2 hits (top destination db 100%)'))
    fireEvent.click(within(panel).getByTestId('direction-in'))
    await waitFor(() => expect(within(traffic).getByTestId('traffic-summary').textContent).toBe('4 hits · top source web (100%) · 4 would be blocked, 0 blocked'))
    fireEvent.click(within(panel).getByTestId('direction-out'))
    await waitFor(() => expect(within(traffic).getByTestId('traffic-summary').textContent).toBe('2 hits · top destination db (100%) · 0 would be blocked, 2 blocked'))
  })
})

describe('pair panel: pending suggestions', () => {
  it('pages the suggestions of the pair, the busiest first, each with the ways out of Observation', async () => {
    mock.routes['POST /suggestions/resolve'] = () => reply(200, { version: 4 })
    const many = Array.from({ length: 7 }, (_, i) => wouldBlock(`s${i}`, { hits: i + 1, dport: String(8000 + i) }))
    setup({ suggestions: many })
    const panel = await openCell('web', 'db')
    const pending = section(panel, 'Pending suggestions')
    expect(within(panel).getByTestId('section-edge.suggestions-count').textContent).toBe('7')
    const rows = within(pending).getAllByRole('listitem')
    expect(rows).toHaveLength(5)
    expect(rows[0].getAttribute('data-suggestion')).toBe('s6')
    expect(within(rows[0]).getByRole('button', { name: /^Accept as flow web → db/ })).toBeTruthy()
    expect(within(rows[0]).getByRole('button', { name: 'Accept as CIDR' })).toBeTruthy()
    fireEvent.click(within(pending).getByRole('button', { name: 'Next page' }))
    expect(within(pending).getAllByRole('listitem')).toHaveLength(2)

    fireEvent.click(within(within(pending).getAllByRole('listitem')[0]).getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(calls('POST /suggestions/resolve')).toHaveLength(1))
  })

  it('lists towards Outside the outbound flows the source zone emitted, named after their destination, As CIDR asking the prefix', async () => {
    setup({
      flows: [toOutside],
      suggestions: [
        wouldBlock('o1', { direction: 'out', src_key: 'zw', dst_zone_id: '', src_ip: '10.0.0.1', dst_ip: '172.30.99.43', dst_key: '172.30.99.43', hits: 9 }),
        wouldBlock('o2', { direction: 'out', src_key: 'zw', dst_zone_id: '', dst_ip: '', dst_key: '0.0.0.0/0', hits: 3 }),
        wouldBlock('o3', { direction: 'out', src_zone_id: 'zd', src_key: 'zd', dst_zone_id: '', dst_ip: '8.8.8.8', dst_key: '8.8.8.8' }),
      ],
    })
    const panel = await openCell('web', 'Outside')
    const pending = section(panel, 'Pending suggestions')
    expect(within(pending).getAllByRole('listitem').map(r => r.getAttribute('aria-label'))).toEqual(['web to 172.30.99.43', 'web to Many destinations'])
    expect(within(within(pending).getAllByRole('listitem')[0]).getByRole('img', { name: 'Outbound' }).getAttribute('data-direction')).toBe('out')
    fireEvent.click(within(within(pending).getAllByRole('listitem')[0]).getByRole('button', { name: 'Accept as CIDR' }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(calls('POST /suggestions/resolve')).toHaveLength(0)
  })
})

describe('pair panel: declared flows', () => {
  it('lists the flows declared between the two zones with their edit and delete, and adds one prefilled', async () => {
    setup({ flows: [flowOf('f1'), flowOf('f2', { dport: '22' }), flowOf('f3', { src_zone_id: 'zd', dst_zone_id: 'zw' })] })
    const panel = await openCell('web', 'db')
    const declared = section(panel, 'Declared flows')
    expect(within(panel).getByTestId('section-edge.flows-count').textContent).toBe('2')
    const rows = within(declared).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByRole('button', { name: 'Edit flow' })).toBeTruthy()
    expect(within(rows[0]).getByRole('button', { name: 'Delete flow' })).toBeTruthy()

    fireEvent.click(within(panel).getByRole('button', { name: 'New flow between these zones' }))
    const dialog = await screen.findByRole('dialog', { name: 'New flow' })
    expect(within(dialog).getAllByText('web').length).toBeGreaterThan(0)
    expect(within(dialog).getAllByText('db').length).toBeGreaterThan(0)
  })
})

describe('pair panel: expanded in a dialog', () => {
  it('opens the traffic, the data and the events of the pair in a centred dialog with tabs', async () => {
    mock.routes['GET /events?limit=200'] = () => reply(200, {
      events: [
        event('db', 'web'),
        event('web', 'db', { direction: 'out', dst_ip: '172.30.99.43' }),
        event('web', 'db'),
        event('db', 'x'),
      ],
      truncated: false, oldest: null,
    })
    setup({ flows: [flowOf('f1')], suggestions: [wouldBlock('s1')] })
    const panel = await openCell('web', 'db')
    fireEvent.click(within(panel).getByRole('button', { name: 'Expand' }))

    const dialog = await screen.findByRole('dialog', { name: 'Flow details · web → db' })
    expect(within(dialog).getByRole('heading', { name: 'Flow details' })).toBeTruthy()
    expect(within(dialog).getByTestId('pair-ends').textContent).toBe('webdb')
    expect(within(dialog).getAllByRole('tab').map(t => t.textContent)).toEqual(['Traffic', 'Data', 'Logs'])
    expect(within(dialog).getByTestId('direction-both')).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('tab', { name: 'Data' }))
    expect(within(dialog).getAllByRole('tab').map(t => t.textContent).slice(3)).toEqual(['Pending suggestions (1)', 'Declared flows (1)'])
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(1)
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Declared flows (1)' }))
    expect(within(dialog).getByRole('button', { name: 'New flow' })).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('tab', { name: 'Logs' }))
    await waitFor(() => expect(within(dialog).getAllByRole('row')).toHaveLength(3))
    expect(within(dialog).getAllByRole('columnheader').map(c => c.textContent)).toEqual(['Time', 'Direction', 'Verdict', 'Source', 'Destination', 'Service', 'Node'])
    expect(within(dialog).getByText('172.30.99.43')).toBeTruthy()
    expect(within(dialog).getAllByText('Outbound').length).toBeGreaterThan(0)
  })

  it('says when the engine holds no event of the pair', async () => {
    mock.routes['GET /events?limit=200'] = () => reply(200, { events: [event('web', 'db')], truncated: false, oldest: null })
    setup({ flows: [flowOf('f1')] })
    const panel = await openCell('web', 'db')
    fireEvent.click(within(panel).getByRole('button', { name: 'Expand' }))
    const dialog = await screen.findByRole('dialog', { name: 'Flow details · web → db' })
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Logs' }))
    expect(await within(dialog).findByText("No event of this pair in the engine's memory")).toBeTruthy()
  })
})

describe('pair panel: the Sankey diagram', () => {
  it('opens the same panel from a ribbon, with its sections and the dialog', async () => {
    window.localStorage.setItem('microseg.map.view', 'sankey')
    setup({ flows: [flowOf('f1')], suggestions: [wouldBlock('s1')] })
    const ribbon = () => document.querySelector('[data-ribbon="unprotected:cell:zone:zw>zone:zd"]')
    await waitFor(() => expect(ribbon()).toBeTruthy())
    fireEvent.click(ribbon()!)
    const panel = await screen.findByRole('complementary', { name: 'Flow web to db' })
    expect(within(panel).getByTestId('pair-ends').textContent).toBe('webdb')
    expect([...panel.querySelectorAll('section[data-section]')].map(s => s.getAttribute('aria-label'))).toEqual(['Observed traffic', 'Pending suggestions', 'Declared flows'])
    fireEvent.click(within(panel).getByRole('button', { name: 'Expand' }))
    expect(await screen.findByRole('dialog', { name: 'Flow details · web → db' })).toBeTruthy()
  })
})

describe('pair panel: exceptions', () => {
  const vms = [vm(100, 'web-1', ['zone-web'], { ips: ['10.0.0.1'] }), vm(200, 'db-1', ['zone-db'], { ips: ['10.0.0.2'] })]
  const toDb = (id: string, over: Parameters<typeof exception>[1] = {}) => exception(id, {
    zone_id: 'zd', sources: [{ type: 'qemu', vmid: 100, name: 'web-1' }], destinations: [{ type: 'qemu', vmid: 200, name: 'db-1' }], ...over,
  })
  const sections = (panel: HTMLElement) => [...panel.querySelectorAll('section[data-section]')].map(s => s.getAttribute('aria-label'))

  async function openEdge(view: string, name: string, panelName: string) {
    window.localStorage.setItem('microseg.map.view', view)
    fireEvent.click(await screen.findByRole('button', { name }))
    return screen.findByRole('complementary', { name: panelName })
  }

  it('lists the exceptions of a link that only stands for them first, with their count in the header, and edits and deletes them', async () => {
    window.localStorage.setItem('microseg.map.view', 'compact')
    setup({ vms, exceptions: [toDb('e1'), toDb('e2', { services: [{ proto: 'tcp', dport: '22' }] }), exception('other')] })
    const panel = await openEdge('compact', 'web to db: 2 exceptions', 'Flow web to db')
    expect(within(panel).getByText('Exception between VMs')).toBeTruthy()
    expect(within(panel).getByText('2 exceptions')).toBeTruthy()
    expect(sections(panel)).toEqual(['VM exceptions', 'Observed traffic', 'Pending suggestions', 'Declared flows'])
    expect(within(panel).getByTestId('section-edge.exceptions-count').textContent).toBe('2')
    const region = section(panel, 'VM exceptions')
    const rows = await within(region).findAllByRole('listitem')
    expect(rows.map(r => r.getAttribute('aria-label'))).toEqual(['web-1 → db-1 · PostgreSQL', 'web-1 → db-1 · SSH'])

    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Edit exception' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Source VMs')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    mock.routes['DELETE /exceptions/e2'] = () => reply(200, { version: 4 })
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Delete exception' }))
    const confirm = await screen.findByRole('dialog', { name: 'Delete this exception?' })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(calls('DELETE /exceptions/e2')).toHaveLength(1))
  })

  it('keeps the count beside the services of an allowed link, and lists its exceptions after its declared flows', async () => {
    window.localStorage.setItem('microseg.map.view', 'compact')
    setup({ vms, flows: [flowOf('f1')], exceptions: [toDb('e1')] })
    const panel = await openEdge('compact', 'web to db: HTTPS (tcp/443) · 1 exception', 'Flow web to db')
    expect(within(panel).getByText('Allowed')).toBeTruthy()
    expect(within(panel).getByText('HTTPS · 1 exception')).toBeTruthy()
    expect(sections(panel)).toEqual(['Observed traffic', 'Pending suggestions', 'Declared flows', 'VM exceptions'])
    expect(await within(section(panel, 'VM exceptions')).findByRole('listitem', { name: 'web-1 → db-1 · PostgreSQL' })).toBeTruthy()
    expect(within(panel).getByTestId('section-edge.flows-count').textContent).toBe('1')

    fireEvent.click(within(panel).getByRole('button', { name: 'Expand' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Data' }))
    fireEvent.click(within(dialog).getByRole('tab', { name: 'VM exceptions (1)' }))
    expect(await within(dialog).findByRole('listitem', { name: 'web-1 → db-1 · PostgreSQL' })).toBeTruthy()
  })

  it('names the two guests of an exception drawn in the guest view, and lists that exception', async () => {
    window.localStorage.setItem('microseg.map.view', 'guests')
    setup({ vms, exceptions: [toDb('e1'), toDb('e2', { sources: [{ type: 'qemu', vmid: 999, name: 'gone' }] })] })
    const panel = await openEdge('guests', 'web-1 (web) to db-1 (db): PostgreSQL (tcp/5432)', 'Flow web-1 (web) to db-1 (db)')
    expect(within(panel).getByTestId('pair-ends').textContent).toBe('webdb')
    // In the header (the ends above it are the zones), and on the line of the exception.
    const named = within(panel).getAllByText('web-1 → db-1 · PostgreSQL')
    expect(named.some(el => !section(panel, 'VM exceptions').contains(el))).toBe(true)
    expect(sections(panel)[0]).toBe('VM exceptions')
    expect(within(panel).getByTestId('section-edge.exceptions-count').textContent).toBe('1')
    const rows = await within(section(panel, 'VM exceptions')).findAllByRole('listitem')
    expect(rows.map(r => r.getAttribute('aria-label'))).toEqual(['web-1 → db-1 · PostgreSQL'])
  })

  it('shows no exceptions section on a pair without one', async () => {
    setup({ vms, flows: [flowOf('f1')] })
    const panel = await openCell('web', 'db')
    expect(sections(panel)).toEqual(['Observed traffic', 'Pending suggestions', 'Declared flows'])
  })
})
