/**
 * Overview, "Target a VM" (UA43): the search of the toolbar, the focus it locks on each rendering (Groups, Compact,
 * Matrix, Guest view, Sankey), the guest panel with its observed and allowed flows, and how the lock lives with the
 * zone and edge panels.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { within } from '@testing-library/react'

import { screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'

import { calls, mock, reply } from './microsegTestKit'
import { body, installFreshMocks, vm } from './policyTestKit'
import { fitView } from './xyflowTestMock'
import { flowOf, node, setup, wouldBlock } from './zoneMapTestKit'

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
    expect(screen.getByText('Targeting web-1')).toBeTruthy()
    expect(await panel('Guest web-1')).toBeTruthy()
    fireEvent.click((screen.getByText('Targeting web-1').closest('.MuiChip-root') as HTMLElement).querySelector('.MuiChip-deleteIcon')!)
    await waitFor(() => expect(screen.queryByText('Targeting web-1')).toBeNull())
    expect(screen.queryByRole('complementary', { name: 'Guest web-1' })).toBeNull()
    expect(cls('node-guest:zw:qemu/100')).not.toContain('microseg-target')
    expect(cls('node-guest:zw:qemu/101')).not.toContain('microseg-dim')
  })
})

describe('the focus a target locks', () => {
  it('keeps the guest, its observed edges and the allowed edges of its zone lit in Groups, whatever the pointer does', async () => {
    demo()
    await node('guest:zw:qemu/100')
    await target('web-1')
    await waitFor(() => expect(cls('node-guest:zw:qemu/100')).toContain('microseg-target'))
    expect(screen.getByTestId('node-guest:zw:qemu/100').querySelector('[data-target="true"]')).toBeTruthy()
    expect(cls('node-guest:zw:qemu/101')).toContain('microseg-dim')
    expect(cls('node-guest:zd:qemu/200')).not.toContain('microseg-dim')
    expect(cls('edge-unprotected:guest:zw:qemu/100>guest:zd:qemu/200')).not.toContain('microseg-dim')
    expect(cls('edge-allowed:zone:zw>zone:zd')).not.toContain('microseg-dim')
    expect(cls('edge-blocked:guest:zw:qemu/101>guest:zd:qemu/200')).toContain('microseg-dim')
    fireEvent.mouseEnter(screen.getByTestId('node-guest:zw:qemu/101'))
    expect(cls('node-guest:zw:qemu/101')).toContain('microseg-dim')
    expect(cls('node-guest:zw:qemu/100')).toContain('microseg-target')
    // The view fits to its zone and its neighbours.
    await waitFor(() => expect(fitView).toHaveBeenCalledWith(expect.objectContaining({ nodes: expect.arrayContaining([{ id: 'zone:zw' }, { id: 'zone:zd' }]) })))
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
    fireEvent.click(screen.getByText('Targeting web-1'))
    expect(await panel('Guest web-1')).toBeTruthy()
  })

  it('lists its observed flows in and out with their peers and services, and the allowed flows of its zone', async () => {
    demo()
    await node('guest:zw:qemu/100')
    await target('db-1')
    const aside = await panel('Guest db-1')
    const observedList = within(within(aside).getByRole('region', { name: 'Observed flows' })).getAllByRole('listitem')
    expect(observedList.map(r => r.getAttribute('aria-label'))).toEqual(['Incoming, from web-2', 'Incoming, from web-1', 'Incoming, from lost'])
    expect(within(observedList[0]).getByText('SSH')).toBeTruthy()
    expect(within(observedList[0]).getByText('Blocked')).toBeTruthy()
    expect(within(observedList[2]).getByText('PostgreSQL')).toBeTruthy()
    const allowedList = within(within(aside).getByRole('region', { name: 'Allowed flows of its zone' })).getAllByRole('listitem')
    expect(allowedList).toHaveLength(1)
    expect(within(allowedList[0]).getByText('HTTPS')).toBeTruthy()
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
