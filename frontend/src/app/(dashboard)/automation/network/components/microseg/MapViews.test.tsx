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
    expect(within(group).getAllByRole('button').map(b => b.getAttribute('aria-label'))).toEqual(['Groups', 'Compact zones'])
    expect(pressed('Groups')).toBe('true')
  })

  it('keeps the rendering picked in this browser', async () => {
    const first = demo()
    await node('zone:zw')
    pick('Compact zones')
    await waitFor(() => expect(screen.queryAllByTestId(/^node-guest:/)).toHaveLength(0))
    expect(window.localStorage.getItem('microseg.map.view')).toBe('compact')
    first.unmount()
    demo()
    await node('zone:zw')
    expect(pressed('Compact zones')).toBe('true')
    expect(screen.queryAllByTestId(/^node-guest:/)).toHaveLength(0)
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
