/**
 * Overview, "Target a VM" (UA43): the search of the toolbar, the focus it locks on each rendering (Groups, Compact,
 * Matrix, Guest view, Sankey), the guest panel with its observed and allowed flows, and how the lock lives with the
 * zone and edge panels.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { within } from '@testing-library/react'

import { screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'

import { GUESTS_ROUTE, REVISION_HEAD, calls, mock, policy, renderTab, reply, zone } from './microsegTestKit'
import { body, db, installFreshMocks, vm, web } from './policyTestKit'
import { fitView } from './xyflowTestMock'
import { SUGGESTIONS, flowOf, node, setup, wouldBlock } from './zoneMapTestKit'

installFreshMocks()
beforeEach(() => fitView.mockClear())

const guests = [
  vm(100, 'web-1', ['zone-web'], { ips: ['10.0.0.1/24'] }),
  vm(101, 'web-2', ['zone-web'], { ips: ['10.0.0.3'] }),
  vm(200, 'db-1', ['zone-db'], { ips: ['10.0.0.2'] }),
  vm(300, 'lost', [], { ips: ['10.0.9.9'] }),
  vm(400, 'old', ['zone-web'], { status: 'stopped' }),
]
const observed = [
  wouldBlock('s1', { src_ip: '10.0.0.1', dst_ip: '10.0.0.2', hits: 5 }),
  wouldBlock('s2', { kind: 'blocked', src_ip: '10.0.0.3', dst_ip: '10.0.0.2', dport: '22', hits: 7 }),
  wouldBlock('s3', { src_zone_id: '', src_ip: '10.0.9.9', dst_ip: '10.0.0.2', dport: '5432', hits: 2 }),
]
const demo = () => setup({ vms: guests, flows: [flowOf('f1')], suggestions: observed })

const search = () => screen.getByRole('combobox', { name: 'Target a VM' })
// The change that opens the list shows every option (MUI): open it first, then type.
function open() {
  search().focus()
  fireEvent.keyDown(search(), { key: 'ArrowDown' })
}
const options = () => screen.queryAllByRole('option').map(o => o.getAttribute('aria-label'))
async function expectOptions(text: string, expected: string[]) {
  open()
  fireEvent.change(search(), { target: { value: text } })
  await waitFor(() => expect(options()).toEqual(expected))
}
async function target(name: string) {
  open()
  fireEvent.change(search(), { target: { value: name } })
  fireEvent.click(await screen.findByRole('option', { name: new RegExp(`^${name},`) }))
}
const cls = (id: string) => screen.getByTestId(id).getAttribute('class') ?? ''
const panel = (name: string) => screen.findByRole('complementary', { name })

describe('the target search', () => {
  it('lists the running guests by name, VMID or address, one line each with their zone', async () => {
    demo()
    await node('guest:zw:qemu/100')
    await expectOptions('db', ['db-1, guest 200, db'])
    await expectOptions('10.0.0.3', ['web-2, guest 101, web'])
    await expectOptions('30', ['lost, guest 300, no zone'])
    await expectOptions('old', [])
    expect(screen.getByText('No running guest matches')).toBeTruthy()
  })

  it('locks the map on the guest picked, says so in a chip, and clears it from the chip', async () => {
    demo()
    await node('guest:zw:qemu/100')
    await target('web-1')
    expect(screen.getByText('Targeting web-1 · 1 observed flow')).toBeTruthy()
    expect(await panel('Guest web-1')).toBeTruthy()
    fireEvent.click((screen.getByText(/^Targeting web-1 ·/).closest('.MuiChip-root') as HTMLElement).querySelector('.MuiChip-deleteIcon')!)
    await waitFor(() => expect(screen.queryByText(/^Targeting web-1 ·/)).toBeNull())
    expect(screen.queryByRole('complementary', { name: 'Guest web-1' })).toBeNull()
    expect(cls('node-guest:zw:qemu/100')).not.toContain('microseg-target')
    expect(cls('node-guest:zw:qemu/101')).not.toContain('microseg-dim')
  })
})

describe('the focus a target locks', () => {
  it('keeps the guest and its observed edges lit in Groups, the allowed flows between kept zones dimmed, whatever the pointer does', async () => {
    demo()
    await node('guest:zw:qemu/100')
    await target('web-1')
    await waitFor(() => expect(cls('node-guest:zw:qemu/100')).toContain('microseg-target'))
    expect(screen.getByTestId('node-guest:zw:qemu/100').querySelector('[data-target="true"]')).toBeTruthy()
    expect(cls('node-guest:zw:qemu/101')).toContain('microseg-dim')
    expect(cls('node-guest:zd:qemu/200')).not.toContain('microseg-dim')
    expect(cls('edge-unprotected:guest:zw:qemu/100>guest:zd:qemu/200')).not.toContain('microseg-dim')
    // Web and db are both kept (the pair web-1 to db-1): their allowed flow is context, dimmed, not faint.
    expect(cls('edge-allowed:zone:zw>zone:zd')).toContain('microseg-dim')
    expect(cls('edge-allowed:zone:zw>zone:zd')).not.toContain('microseg-faint')
    expect(cls('edge-blocked:guest:zw:qemu/101>guest:zd:qemu/200')).toContain('microseg-dim')
    fireEvent.mouseEnter(screen.getByTestId('node-guest:zw:qemu/101'))
    expect(cls('node-guest:zw:qemu/101')).toContain('microseg-dim')
    expect(cls('node-guest:zw:qemu/100')).toContain('microseg-target')
    // The view fits to its zone and its neighbours.
    await waitFor(() => expect(fitView).toHaveBeenCalledWith(expect.objectContaining({ nodes: expect.arrayContaining([{ id: 'zone:zw' }, { id: 'zone:zd' }]) })))
  })

  it('keeps only the zones of its pairs: an unrelated zone and its edges are a faint outline', async () => {
    setup({ zones: [web(), db(), zone('zc', { name: 'cache' })], vms: [...guests, vm(600, 'cache-1', ['zone-cache'], { ips: ['10.0.5.5'] })], flows: [flowOf('f1'), flowOf('f2', { src_zone_id: 'zc', dst_zone_id: 'zd' })], suggestions: observed })
    await node('guest:zw:qemu/100')
    await target('web-1')
    await waitFor(() => expect(cls('node-zone:zc')).toContain('microseg-faint'))
    expect(cls('node-guest:zc:qemu/600')).toContain('microseg-faint')
    expect(cls('edge-allowed:zone:zc>zone:zd')).toContain('microseg-faint')
    expect(cls('node-zone:zd')).not.toContain('microseg-faint')
    expect(cls('node-zone:zw')).not.toContain('microseg-faint')
  })

  it('lights its zone box in Compact zones', async () => {
    demo()
    await node('guest:zw:qemu/100')
    await target('web-1')
    fireEvent.click(screen.getByRole('button', { name: 'Compact zones' }))
    await waitFor(() => expect(cls('node-zone:zw')).toContain('microseg-target'))
    expect(cls('edge-unprotected:zone:zw>zone:zd')).not.toContain('microseg-dim')
    expect(cls('edge-blocked:zone:zw>zone:zd')).toContain('microseg-dim')
  })

  it('lights the row and the column of its zone in the matrix and marks the cells of its flows', async () => {
    demo()
    await node('guest:zw:qemu/100')
    await target('web-1')
    fireEvent.click(screen.getByRole('button', { name: 'Matrix' }))
    const grid = await screen.findByRole('grid')
    expect(grid.getAttribute('data-lit-row')).toBe('zone:zw')
    expect(grid.getAttribute('data-lit-col')).toBe('zone:zw')
    const cell = (id: string) => grid.querySelector(`[data-id="${id}"]`)!
    expect(cell('cell:zone:zw>zone:zd').getAttribute('data-target')).toBe('true')
    expect(within(cell('cell:zone:zw>zone:zd') as HTMLElement).getByRole('img', { name: 'Observed flows of web-1 in this cell' })).toBeTruthy()
    expect(cell('cell:external>zone:zd').getAttribute('data-target')).toBeNull()
    fireEvent.mouseEnter(cell('cell:external>zone:zd'))
    expect(grid.getAttribute('data-lit-row')).toBe('zone:zw')
  })

  it('highlights the ribbons of its flows in the Sankey diagram and dims the ones away from its zone', async () => {
    demo()
    await node('guest:zw:qemu/100')
    await target('web-1')
    fireEvent.click(screen.getByRole('button', { name: 'Sankey diagram' }))
    const ribbon = async (id: string) => (await screen.findByRole('figure')).querySelector(`[data-ribbon="${id}"]`)!.getAttribute('data-state')
    expect(await ribbon('unprotected:cell:zone:zw>zone:zd')).toBe('target')
    expect(await ribbon('blocked:cell:zone:zw>zone:zd')).toBe('lit')
    expect(await ribbon('unprotected:cell:external>zone:zd')).toBe('dim')
  })

  it('puts the zone of the guest in the centre of the guest view, the guest ringed', async () => {
    demo()
    await node('guest:zw:qemu/100')
    fireEvent.click(screen.getByRole('button', { name: 'Guest view' }))
    // The busiest zone opens first: db.
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Zone in the centre' }).textContent).toContain('db'))
    await target('web-1')
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Zone in the centre' }).textContent).toContain('web'))
    await waitFor(() => expect(cls('node-guest:zw:qemu/100')).toContain('microseg-target'))
    expect(cls('edge-unprotected:guest:zw:qemu/100>guest:zd:qemu/200')).not.toContain('microseg-dim')
    expect(cls('edge-blocked:guest:zw:qemu/101>guest:zd:qemu/200')).toContain('microseg-dim')
  })
})

describe('the guest panel', () => {
  it('shows who the guest is, its zone, and opens the zone panel', async () => {
    demo()
    await node('guest:zw:qemu/100')
    await target('web-1')
    const aside = await panel('Guest web-1')
    expect(within(aside).getByText('VM 100 on pve1')).toBeTruthy()
    expect(within(aside).getAllByText('web')[0].closest('.MuiChip-root')).toBeTruthy()
    expect(within(aside).getByText('Observation')).toBeTruthy()
    expect(within(aside).getByText('IP addresses: 10.0.0.1/24')).toBeTruthy()
    fireEvent.click(within(aside).getByRole('button', { name: 'Open zone' }))
    expect(await panel('Zone web')).toBeTruthy()
    expect(screen.queryByRole('complementary', { name: 'Guest web-1' })).toBeNull()
    // The lock stays; the chip brings the guest panel back.
    expect(cls('node-guest:zw:qemu/100')).toContain('microseg-target')
    fireEvent.click(screen.getByText(/^Targeting web-1 ·/))
    expect(await panel('Guest web-1')).toBeTruthy()
  })

  it('lists its observed flows in and out with their peers and services, and the rules of its zone folded', async () => {
    demo()
    await node('guest:zw:qemu/100')
    await target('db-1')
    const aside = await panel('Guest db-1')
    const observedList = within(within(aside).getByRole('region', { name: 'Flows' })).getAllByRole('listitem')
    expect(within(aside).getByTestId('section-guest.flows-count').textContent).toBe('3')
    expect(observedList.map(r => r.getAttribute('aria-label'))).toEqual(['Incoming, from web-2', 'Incoming, from web-1', 'Incoming, from lost'])
    expect(within(observedList[0]).getByText('SSH')).toBeTruthy()
    expect(within(observedList[0]).getByText('Blocked')).toBeTruthy()
    expect(within(observedList[2]).getByText('PostgreSQL')).toBeTruthy()
    expect(within(aside).getByTestId('section-guest.zoneRules').getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(within(aside).getByTestId('section-guest.zoneRules'))
    const allowedList = within(within(aside).getByRole('region', { name: 'Rules of its zone' })).getAllByRole('listitem')
    expect(allowedList).toHaveLength(1)
    expect(within(allowedList[0]).getByText('HTTPS')).toBeTruthy()
  })

  it('keeps room for the guest and zone names in its narrow rows, cut only beyond, with the full name as tooltip (D8)', async () => {
    demo()
    await node('guest:zw:qemu/100')
    await target('db-1')
    const aside = await panel('Guest db-1')
    const row = within(within(aside).getByRole('region', { name: 'Flows' })).getAllByRole('listitem')[0]
    // The peer name holds 96 px; the kind chip gives way first.
    expect(within(row).getByText('web-2').parentElement!).toHaveStyle({ minWidth: '96px' })
    expect(within(row).getByText('Blocked').closest('.MuiChip-root')).toHaveStyle({ minWidth: '0' })
    fireEvent.mouseOver(within(row).getByText('web-2'))
    expect(await screen.findByRole('tooltip', { name: 'Incoming, from web-2' })).toBeTruthy()
    // Each side of an allowed flow holds 48 px before its ellipsis.
    fireEvent.click(within(aside).getByTestId('section-guest.zoneRules'))
    const allowed = within(within(aside).getByRole('region', { name: 'Rules of its zone' })).getAllByRole('listitem')[0]
    expect(within(allowed).getAllByText(/^(web|db)$/)[0].parentElement!.parentElement!).toHaveStyle({ minWidth: '48px' })
  })

  it('resolves an observed flow from its row, with the sample note in the accept tooltip', async () => {
    mock.routes['POST /suggestions/resolve'] = () => reply(200, { version: 4 })
    demo()
    await node('guest:zw:qemu/100')
    await target('web-1')
    const row = within(await panel('Guest web-1')).getByRole('listitem', { name: 'Outgoing, to db-1' })
    const accept = within(row).getByRole('button', { name: 'Accept as flow web → db HTTP (tcp/80)' })
    fireEvent.mouseOver(accept)
    expect(await screen.findByText(/the engine keeps one sample pair of guests per observed flow, so the flow covers the whole zone pair/)).toBeTruthy()
    fireEvent.click(accept)
    await waitFor(() => expect(calls('POST /suggestions/resolve')).toHaveLength(1))
    expect(body(calls('POST /suggestions/resolve')[0][1])).toEqual({ version: 3, ids: ['s1'], action: 'accept' })
    fireEvent.click(within(row).getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(calls('POST /suggestions/resolve')).toHaveLength(2))
    expect(body(calls('POST /suggestions/resolve')[1][1])).toEqual({ version: 3, ids: ['s1'], action: 'dismiss' })
  })

  it('says when a guest is in no zone, and when it has no address', async () => {
    setup({ vms: [...guests, vm(500, 'bare', [])], flows: [flowOf('f1')], suggestions: observed })
    await node('guest:zw:qemu/100')
    await target('lost')
    const aside = await panel('Guest lost')
    expect(within(aside).getByText('In no zone')).toBeTruthy()
    expect(within(aside).queryByRole('button', { name: 'Open zone' })).toBeNull()
    fireEvent.click(within(aside).getByTestId('section-guest.zoneRules'))
    expect(within(aside).getByText('This guest is in no zone: no allowed flow applies to it.')).toBeTruthy()
    expect(within(aside).getAllByRole('listitem').map(r => r.getAttribute('aria-label'))).toEqual(['Outgoing, to db-1'])
    await target('bare')
    expect(within(await panel('Guest bare')).getByText('No IP address known: the observed flows cannot be matched to this guest.')).toBeTruthy()
  })

  it('gives way to an edge panel picked while the target stays locked', async () => {
    demo()
    await node('guest:zw:qemu/100')
    await target('web-1')
    await panel('Guest web-1')
    fireEvent.click(screen.getByTestId('edge-allowed:zone:zw>zone:zd'))
    expect(await panel('Flow web to db')).toBeTruthy()
    expect(screen.queryByRole('complementary', { name: 'Guest web-1' })).toBeNull()
    expect(cls('node-guest:zw:qemu/100')).toContain('microseg-target')
    fireEvent.click(within(screen.getByRole('complementary', { name: 'Flow web to db' })).getByRole('button', { name: 'Close' }))
    expect(await panel('Guest web-1')).toBeTruthy()
  })
})

describe('fix round 1', () => {
  const centre = () => screen.getByRole('combobox', { name: 'Zone in the centre' })
  async function pickCentre(name: string) {
    fireEvent.mouseDown(centre())
    fireEvent.click(await screen.findByRole('option', { name: new RegExp(`^${name} `) }))
  }

  it('leaves the map undimmed, and the pointer working, when the canvas draws nothing of the target', async () => {
    setup({ zones: [web(), db(), zone('zc', { name: 'cache' })], vms: guests, flows: [flowOf('f1')], suggestions: observed })
    await node('guest:zw:qemu/100')
    fireEvent.click(screen.getByRole('button', { name: 'Guest view' }))
    await target('web-1')
    await waitFor(() => expect(centre().textContent).toContain('web'))
    await pickCentre('cache')
    await waitFor(() => expect(screen.queryByTestId('node-guest:zw:qemu/100')).toBeNull())
    expect(cls('node-zone:zc')).not.toContain('microseg-dim')
    expect(screen.getByText(/^Targeting web-1 ·/)).toBeTruthy()
  })

  it('puts the zone back in the centre for every guest targeted, even in the zone it already had', async () => {
    demo()
    await node('guest:zw:qemu/100')
    fireEvent.click(screen.getByRole('button', { name: 'Guest view' }))
    await target('web-1')
    await waitFor(() => expect(centre().textContent).toContain('web'))
    await pickCentre('db')
    await waitFor(() => expect(centre().textContent).toContain('db'))
    await target('web-2')
    await waitFor(() => expect(centre().textContent).toContain('web'))
  })

  it('fits the neighbourhood automatically, the whole graph from the Fit view button', async () => {
    demo()
    await node('guest:zw:qemu/100')
    await target('web-1')
    await waitFor(() => expect(fitView).toHaveBeenCalledWith(expect.objectContaining({ nodes: expect.any(Array) })))
    fitView.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Fit the map to the view' }))
    expect(fitView).toHaveBeenCalledTimes(1)
    expect(fitView.mock.calls[0]).toEqual([{ padding: 0.1, duration: 300, maxZoom: 1 }])
  })

  it('says to type to narrow when the search matches more guests than the list shows', async () => {
    const many = Array.from({ length: 60 }, (_, i) => vm(1000 + i, `bulk-${String(i).padStart(2, '0')}`, []))
    setup({ vms: [...guests, ...many], flows: [flowOf('f1')], suggestions: observed })
    await node('guest:zw:qemu/100')
    open()
    fireEvent.change(search(), { target: { value: 'bulk' } })
    expect(await screen.findByRole('note')).toHaveProperty('textContent', 'Showing the first 50 of 60 guests: type to narrow')
    expect(screen.getAllByRole('option')).toHaveLength(50)
    fireEvent.change(search(), { target: { value: 'bulk-1' } })
    await waitFor(() => expect(screen.queryByRole('note')).toBeNull())
  })

  it('warns in the guest panel when the map read only the first page of observed flows', async () => {
    const full = Array.from({ length: 200 }, (_, i) => wouldBlock(`p${i}`, { src_ip: '10.0.0.1', dst_ip: '10.0.0.2', dport: String(1000 + i), hits: 1 }))
    setup({ vms: guests, flows: [flowOf('f1')], suggestions: full })
    await node('guest:zw:qemu/100')
    await target('web-1')
    expect(within(await panel('Guest web-1')).getByText('Only the first 200 pending observed flows of the map are read: this list may miss some.')).toBeTruthy()
  })

  it('says nothing about a partial read under the limit', async () => {
    demo()
    await node('guest:zw:qemu/100')
    await target('web-1')
    expect(within(await panel('Guest web-1')).queryByText(/Only the first/)).toBeNull()
  })
})

describe('the target search of a user who cannot read the inventory (D9)', () => {
  const COVERAGE = 'GET /api/v1/firewall/coverage/c1'
  const row = (g: ReturnType<typeof vm>) => ({ ...g, enabled: true, optionsEnabled: true, nicFirewall: true, options: null, vlans: [] })

  /** The Overview as a node.view user reads it: the inventory refuses (it asks vm.view), the coverage route answers. */
  function viewer(coverage: () => unknown) {
    window.localStorage.setItem('microseg.subTab', 'overview')
    mock.routes['GET /policy'] = () => reply(200, policy({ zones: [web(), db()], flows: [flowOf('f1')], last_revision: REVISION_HEAD }))
    mock.routes[`GET ${GUESTS_ROUTE}`] = () => reply(403, { error: 'Forbidden' })
    mock.routes[COVERAGE] = coverage
    mock.routes[SUGGESTIONS] = () => reply(200, { suggestions: observed, limit: 200, offset: 0 })
    return renderTab()
  }

  it('lists the running guests of the coverage rows, with their zone from the tags, and targets one', async () => {
    viewer(() => reply(200, { total: 5, measured: 5, computing: false, guests: guests.map(row) }))
    await node('guest:zw:qemu/100')
    await expectOptions('db', ['db-1, guest 200, db'])
    await expectOptions('old', [])
    await target('web-1')
    expect(screen.getByText(/^Targeting web-1 ·/)).toBeTruthy()
    // The rows carry no address: the panel says so instead of listing flows it cannot place.
    expect(within(await panel('Guest web-1')).getByText('No IP address known')).toBeTruthy()
    expect(calls(`GET ${GUESTS_ROUTE}`).length).toBeGreaterThan(0)
  })

  it('never reads the coverage route while the inventory answers', async () => {
    demo()
    await node('guest:zw:qemu/100')
    expect(calls(COVERAGE)).toHaveLength(0)
  })
})
