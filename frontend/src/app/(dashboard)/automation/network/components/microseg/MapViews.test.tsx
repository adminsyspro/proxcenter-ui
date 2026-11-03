/**
 * Overview sub-tab, the renderings of the map: the selector of the toolbar (kept in the browser), Compact zones,
 * the Matrix and the Guest view, each fed from the same draft and observed flows, sharing the flow checkboxes and
 * the panels.
 */

import { describe, expect, it, vi } from 'vitest'
import { within } from '@testing-library/react'

import { screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'

import { db, installFreshMocks, vm, web } from './policyTestKit'
import { flowOf, node, pathOf, setup, wouldBlock } from './zoneMapTestKit'

installFreshMocks()

const guests = [
  vm(100, 'web-1', ['zone-web'], { ips: ['10.0.0.1'] }),
  vm(101, 'web-2', ['zone-web'], { ips: ['10.0.0.3'] }),
  vm(200, 'db-1', ['zone-db'], { ips: ['10.0.0.2'] }),
]
const observed = [
  wouldBlock('s1', { src_ip: '10.0.0.1', dst_ip: '10.0.0.2', hits: 5 }),
  wouldBlock('s2', { kind: 'blocked', src_ip: '10.0.0.3', dst_ip: '10.0.0.2', dport: '22', hits: 7 }),
]
const demo = (over: Parameters<typeof setup>[0] = {}) => setup({ vms: guests, flows: [flowOf('f1')], suggestions: observed, ...over })
const pick = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed')

describe('the rendering selector', () => {
  it('offers the renderings in the toolbar, Groups by default', async () => {
    demo()
    await node('zone:zw')
    const group = screen.getByRole('group', { name: 'Map rendering' })
    expect(within(group).getAllByRole('button').map(b => b.getAttribute('aria-label'))).toEqual(['Groups', 'Compact zones', 'Matrix', 'Guest view', 'Sankey diagram'])
    expect(pressed('Groups')).toBe('true')
  })

  it('keeps the rendering picked in this browser', async () => {
    const first = demo()
    await node('zone:zw')
    pick('Matrix')
    expect(await screen.findByRole('grid', { name: 'Flows between the zones: sources by destinations' })).toBeTruthy()
    expect(window.localStorage.getItem('microseg.map.view')).toBe('matrix')
    first.unmount()
    demo()
    expect(await screen.findByRole('grid')).toBeTruthy()
    expect(pressed('Matrix')).toBe('true')
  })

  it('falls back to Groups on an unknown value or a storage that refuses', async () => {
    window.localStorage.setItem('microseg.map.view', 'radar')
    const first = demo()
    expect(await node('guest:zw:qemu/100')).toBeTruthy()
    first.unmount()
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(key => {
      if (key === 'microseg.map.view') throw new Error('denied')
      return key === 'microseg.subTab' ? 'overview' : null
    })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(key => {
      if (key === 'microseg.map.view') throw new Error('denied')
    })
    demo()
    expect(await node('guest:zw:qemu/100')).toBeTruthy()
    pick('Compact zones')
    expect(await node('zone:zw')).toBeTruthy()
    expect(screen.queryByTestId('node-guest:zw:qemu/100')).toBeNull()
    get.mockRestore()
    set.mockRestore()
  })

  it('keeps the panel of a zone open from one rendering to the other, and closes the panel of an edge', async () => {
    demo()
    fireEvent.click(await node('zone:zw'))
    expect(await screen.findByRole('complementary', { name: 'Zone web' })).toBeTruthy()
    pick('Compact zones')
    expect(screen.getByRole('complementary', { name: 'Zone web' })).toBeTruthy()
    fireEvent.click(await screen.findByTestId('edge-allowed:zone:zw>zone:zd'))
    expect(await screen.findByRole('complementary', { name: 'Flow web to db' })).toBeTruthy()
    pick('Groups')
    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull())
  })
})

describe('compact zones', () => {
  it('draws a box per zone, no guest, and the observed flows zone to zone', async () => {
    window.localStorage.setItem('microseg.map.view', 'compact')
    demo()
    const box = await node('zone:zw')
    expect(within(box).getByText('web')).toBeTruthy()
    await waitFor(() => expect(within(box).getByText(/2 members/)).toBeTruthy())
    expect(screen.queryAllByTestId(/^node-guest:/)).toHaveLength(0)
    expect((await pathOf('unprotected:zone:zw>zone:zd')).getAttribute('data-stroke')).toBe('#e53935')
    expect((await pathOf('blocked:zone:zw>zone:zd')).getAttribute('data-stroke')).toBe('#1565c0')
  })

  it('follows the flow checkboxes and opens the panel of a zone', async () => {
    window.localStorage.setItem('microseg.map.view', 'compact')
    demo()
    await pathOf('unprotected:zone:zw>zone:zd')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Unprotected' }))
    await waitFor(() => expect(screen.queryByTestId('edge-unprotected:zone:zw>zone:zd')).toBeNull())
    expect(screen.getByTestId('edge-blocked:zone:zw>zone:zd')).toBeTruthy()
    fireEvent.keyDown(within(await node('zone:zd')).getByRole('button', { name: /Zone db/ }), { key: 'Enter' })
    expect(await screen.findByRole('complementary', { name: 'Zone db' })).toBeTruthy()
  })
})

describe('box nodes', () => {
  it('lights a zone box and its edges while it has the keyboard focus, and nothing else', async () => {
    window.localStorage.setItem('microseg.map.view', 'compact')
    demo({ zones: [web(), db(), { ...web(), id: 'zq', name: 'quiet' }] })
    const button = within(await node('zone:zw')).getByRole('button', { name: /Zone web/ })
    fireEvent.focus(button)
    await waitFor(() => expect(screen.getByTestId('node-zone:zq').className).toContain('microseg-dim'))
    expect(screen.getByTestId('node-zone:zd').className).not.toContain('microseg-dim')
    fireEvent.blur(button)
    await waitFor(() => expect(screen.getByTestId('node-zone:zq').className).not.toContain('microseg-dim'))
  })

  it('draws an address in no zone that talked to the zone of the guest view as its own box', async () => {
    window.localStorage.setItem('microseg.map.view', 'guests')
    demo({ suggestions: [...observed, wouldBlock('s9', { src_zone_id: '', src_ip: '203.0.113.9', dst_ip: '10.0.0.2', hits: 50 })] })
    const box = await node('ip:203.0.113.9')
    expect(within(box).getByText('203.0.113.9')).toBeTruthy()
    expect(await pathOf('unprotected:ip:203.0.113.9>guest:zd:qemu/200')).toBeTruthy()
  })
})

describe('the matrix', () => {
  const cell = (from: string, to: string) => screen.getByRole('gridcell', { name: new RegExp(`^${from} to ${to}:`) })

  it('draws a cell per pair: allowed ports, observed ports red or blue dashed, hits, the tone of the pair', async () => {
    window.localStorage.setItem('microseg.map.view', 'matrix')
    demo()
    await screen.findByRole('grid')
    await waitFor(() => expect(cell('web', 'db').getAttribute('data-tone')).toBe('unprotected'))
    const c = cell('web', 'db')
    expect(c.getAttribute('aria-label')).toBe('web to db: Allowed: tcp/443, 1 unprotected flow, 1 blocked flow, 12 hits')
    expect(within(c).getByText('tcp/443')).toBeTruthy()
    expect(within(c).getByText('tcp/80')).toBeTruthy()
    expect(within(c).getByText('tcp/22')).toBeTruthy()
    expect(within(c).getByText('12 hits')).toBeTruthy()
    expect(cell('db', 'web').getAttribute('aria-label')).toBe('db to web: no flow')
    expect(screen.getAllByRole('columnheader').map(h => h.textContent)).toEqual(expect.arrayContaining(['db', 'web', 'Outside']))
    expect(screen.getAllByRole('rowheader').map(h => h.textContent)).toEqual(['db', 'web', 'Unknown / External'])
  })

  it('opens the panel of the pair with its observed and allowed flows, and the panel of a zone from its head', async () => {
    window.localStorage.setItem('microseg.map.view', 'matrix')
    demo()
    await screen.findByRole('grid')
    await waitFor(() => expect(cell('web', 'db').getAttribute('data-tone')).toBe('unprotected'))
    fireEvent.click(cell('web', 'db'))
    const panel = await screen.findByRole('complementary', { name: 'Flow web to db' })
    expect(within(panel).getByText('Observed flows')).toBeTruthy()
    expect(within(panel).getByText('Allowed flows')).toBeTruthy()
    expect(within(panel).getAllByRole('listitem').length).toBeGreaterThanOrEqual(3)
    expect(cell('web', 'db').getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getAllByRole('button', { name: 'Open the panel of zone db' })[0])
    expect(await screen.findByRole('complementary', { name: 'Zone db' })).toBeTruthy()
  })

  it('follows the checkboxes, moves with the arrows and opens with enter', async () => {
    window.localStorage.setItem('microseg.map.view', 'matrix')
    demo()
    await screen.findByRole('grid')
    await waitFor(() => expect(cell('web', 'db').getAttribute('data-tone')).toBe('unprotected'))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Unprotected' }))
    await waitFor(() => expect(cell('web', 'db').getAttribute('data-tone')).toBe('blocked'))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Blocked' }))
    await waitFor(() => expect(cell('web', 'db').getAttribute('data-tone')).toBe('allowed'))
    expect(within(cell('web', 'db')).queryByText('tcp/80')).toBeNull()

    const first = cell('db', 'db')
    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(cell('web', 'db'))
    fireEvent.keyDown(document.activeElement!, { key: 'End' })
    expect(document.activeElement).toBe(cell('web', 'Outside'))
    fireEvent.keyDown(document.activeElement!, { key: 'Home' })
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' })
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' })
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' })
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' })
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(cell('web', 'db'))
    fireEvent.mouseEnter(document.activeElement!)
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' })
    expect(await screen.findByRole('complementary', { name: 'Flow web to db' })).toBeTruthy()
  })

  it('sorts the zones by name or by layer, and keeps the choice', async () => {
    window.localStorage.setItem('microseg.map.view', 'matrix')
    demo()
    await screen.findByRole('grid')
    fireEvent.click(screen.getByRole('button', { name: 'By layer, as the map reads' }))
    await waitFor(() => expect(screen.getAllByRole('rowheader').map(h => h.textContent)).toEqual(['Unknown / External', 'web', 'db']))
    expect(window.localStorage.getItem('microseg.map.matrixSort')).toBe('layer')
    fireEvent.click(screen.getByRole('button', { name: 'By name' }))
    await waitFor(() => expect(screen.getAllByRole('rowheader').map(h => h.textContent)).toEqual(['db', 'web', 'Unknown / External']))
  })
})

describe('the guest view', () => {
  it('opens on the zone with the most observed traffic, its guests in the centre, the sample pairs said so', async () => {
    window.localStorage.setItem('microseg.map.view', 'guests')
    demo({ zones: [web(), db(), { ...web(), id: 'zq', name: 'quiet' }] })
    const picker = await screen.findByRole('combobox', { name: 'Zone in the centre' })
    await waitFor(() => expect(picker.textContent).toBe('db · 12 hits'))
    expect(screen.getByText('The engine keeps one sample pair of guests per observed flow: the hits count the whole zone pair.')).toBeTruthy()
    expect((await node('guest:zd:qemu/200')).getAttribute('data-parent')).toBe('zone:zd')
    expect(await pathOf('unprotected:guest:zw:qemu/100>guest:zd:qemu/200')).toBeTruthy()
    expect(screen.queryByTestId('node-zone:zq')).toBeNull()
  })

  it('puts another zone in the centre on a click, and opens the panel of the zone in the centre', async () => {
    window.localStorage.setItem('microseg.map.view', 'guests')
    demo()
    const picker = await screen.findByRole('combobox', { name: 'Zone in the centre' })
    await waitFor(() => expect(picker.textContent).toBe('db · 12 hits'))
    fireEvent.click(await node('zone:zw'))
    await waitFor(() => expect(picker.textContent).toBe('web · 12 hits'))
    expect(screen.queryByRole('complementary')).toBeNull()
    fireEvent.click(await node('zone:zw'))
    expect(await screen.findByRole('complementary', { name: 'Zone web' })).toBeTruthy()
  })

  it('changes the zone in the centre from the picker', async () => {
    window.localStorage.setItem('microseg.map.view', 'guests')
    demo()
    const picker = await screen.findByRole('combobox', { name: 'Zone in the centre' })
    await waitFor(() => expect(picker.textContent).toBe('db · 12 hits'))
    fireEvent.mouseDown(picker)
    fireEvent.click(await screen.findByRole('option', { name: 'web · 12 hits' }))
    await waitFor(() => expect(picker.textContent).toBe('web · 12 hits'))
    expect((await node('guest:zw:qemu/100')).getAttribute('data-parent')).toBe('zone:zw')
  })
})

describe('the Sankey diagram', () => {
  const ribbon = (id: string) => document.querySelector(`[data-ribbon="${id}"]`)
  const opacity = (id: string) => ribbon(id)?.getAttribute('stroke-opacity')

  it('draws a ribbon per pair and kind, observed by their hits, allowed thin, and says the allowed ones have no counter', async () => {
    window.localStorage.setItem('microseg.map.view', 'sankey')
    demo()
    expect(await screen.findByRole('img', { name: 'Traffic between the zones as ribbons' })).toBeTruthy()
    await waitFor(() => expect(ribbon('blocked:cell:zone:zw>zone:zd')).toBeTruthy())
    expect(ribbon('blocked:cell:zone:zw>zone:zd')!.getAttribute('stroke-width')).toBe('48')
    expect(ribbon('unprotected:cell:zone:zw>zone:zd')!.getAttribute('stroke')).toBe('#e53935')
    expect(ribbon('allowed:cell:zone:zw>zone:zd')!.getAttribute('stroke-width')).toBe('3')
    expect(ribbon('allowed:cell:zone:zw>zone:zd')!.getAttribute('aria-label')).toBe('web to db: tcp/443, 1 allowed flow')
    expect(screen.getAllByText('Ribbon width follows the hits of the observed flows. Allowed flows have no counter: they are drawn thin.').length).toBeGreaterThan(0)
    expect(document.querySelector('[data-node="source:zone:zw"]')).toBeTruthy()
    expect(document.querySelector('[data-node="target:zone:zd"]')).toBeTruthy()
  })

  it('dims the other ribbons on hover, opens the panel of the pair on a click and the panel of a zone from its node', async () => {
    window.localStorage.setItem('microseg.map.view', 'sankey')
    demo()
    await waitFor(() => expect(ribbon('blocked:cell:zone:zw>zone:zd')).toBeTruthy())
    fireEvent.mouseEnter(ribbon('blocked:cell:zone:zw>zone:zd')!)
    expect(opacity('blocked:cell:zone:zw>zone:zd')).toBe('0.55')
    expect(opacity('allowed:cell:zone:zw>zone:zd')).toBe('0.1')
    fireEvent.mouseLeave(ribbon('blocked:cell:zone:zw>zone:zd')!)
    expect(opacity('allowed:cell:zone:zw>zone:zd')).toBe('0.55')
    fireEvent.click(ribbon('blocked:cell:zone:zw>zone:zd')!)
    const panel = await screen.findByRole('complementary', { name: 'Flow web to db' })
    expect(within(panel).getByText('Observed flows')).toBeTruthy()
    expect(within(panel).getByText('Allowed flows')).toBeTruthy()
    const target = document.querySelector('[data-node="target:zone:zd"]')!
    fireEvent.mouseEnter(target)
    fireEvent.mouseLeave(target)
    fireEvent.keyDown(target, { key: 'Enter' })
    expect(await screen.findByRole('complementary', { name: 'Zone db' })).toBeTruthy()
    expect(opacity('allowed:cell:zone:zw>zone:zd')).toBe('0.55')
  })

  it('follows the checkboxes, and says so when nothing is left', async () => {
    window.localStorage.setItem('microseg.map.view', 'sankey')
    demo()
    await waitFor(() => expect(ribbon('allowed:cell:zone:zw>zone:zd')).toBeTruthy())
    fireEvent.click(screen.getByRole('checkbox', { name: 'Allowed' }))
    await waitFor(() => expect(ribbon('allowed:cell:zone:zw>zone:zd')).toBeNull())
    fireEvent.keyDown(ribbon('unprotected:cell:zone:zw>zone:zd')!, { key: 'Enter' })
    expect(await screen.findByRole('complementary', { name: 'Flow web to db' })).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Unprotected' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Blocked' }))
    expect(await screen.findByText('No flow to draw with these filters.')).toBeTruthy()
  })
})
