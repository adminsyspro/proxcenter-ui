/**
 * Overview sub-tab, the inside of a zone: a double click on a zone (or the button of its panel) enters it, the canvas
 * then shows the zone alone with its guests and what they exchange, until the way back or another rendering.
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
  // Between two guests of web.
  wouldBlock('s2', { src_ip: '10.0.0.1', dst_zone_id: 'zw', dst_ip: '10.0.0.3', dport: '22', hits: 7 }),
]
const demo = (over: Parameters<typeof setup>[0] = {}) => setup({ vms: guests, flows: [flowOf('f1')], suggestions: observed, ...over })
const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed')
/** The two clicks of a double click, as the browser sends them: the second one says it is the second. */
const doubleClick = async (id: string) => {
  const zone = await node(id)
  fireEvent.click(zone)
  fireEvent.click(zone, { detail: 2 })
}
const bar = () => screen.findByTestId('zone-inside-back')

describe('entering a zone', () => {
  it('opens the panel on a click and leaves the map as it is', async () => {
    demo()
    fireEvent.click(await node('zone:zw'))
    expect(await screen.findByRole('complementary', { name: 'Zone web' })).toBeTruthy()
    expect(screen.queryByTestId('zone-inside-back')).toBeNull()
    expect((await node('guest:zd:qemu/200')).getAttribute('data-parent')).toBe('zone:zd')
    expect(pressed('Groups')).toBe('true')
  })

  it('enters the zone on a double click: the zone alone with its guests, the other zones as boxes, its panel open', async () => {
    demo()
    await doubleClick('zone:zw')
    expect((await bar()).textContent).toBe('Back to the map')
    expect(screen.getByRole('complementary', { name: 'Zone web' })).toBeTruthy()
    expect((await node('guest:zw:qemu/100')).getAttribute('data-parent')).toBe('zone:zw')
    expect((await node('guest:zw:qemu/101')).getAttribute('data-parent')).toBe('zone:zw')
    // db is folded into its box: none of its guests is drawn, the flow with it starts on the guest of web.
    expect(await node('zone:zd')).toBeTruthy()
    expect(screen.queryByTestId('node-guest:zd:qemu/200')).toBeNull()
    expect(await pathOf('unprotected:guest:zw:qemu/100>zone:zd')).toBeTruthy()
    expect(await pathOf('allowed:zone:zw>zone:zd')).toBeTruthy()
    // What two guests of the zone exchange is drawn between them.
    expect(await pathOf('unprotected:guest:zw:qemu/100>guest:zw:qemu/101')).toBeTruthy()
    // No rendering of the toolbar is the one shown, and the one kept in the browser is untouched.
    expect(pressed('Groups')).toBe('false')
    expect(window.localStorage.getItem('microseg.map.view')).not.toBe('guests')
    // Every flow drawn is one of the zone: the map does not offer to isolate them.
    expect(screen.queryByTestId('map-isolation')).toBeNull()
  })

  it('tells how to enter a zone in its tooltip, not once inside it', async () => {
    demo()
    fireEvent.mouseOver(within(await node('zone:zw')).getByRole('button', { name: /^Zone web/ }))
    expect(await screen.findByText(/Double-click to show its inside/)).toBeTruthy()
  })

  it('goes back to the map with its panel open', async () => {
    demo()
    await doubleClick('zone:zw')
    fireEvent.click(await bar())
    await waitFor(() => expect(screen.queryByTestId('zone-inside-back')).toBeNull())
    expect(pressed('Groups')).toBe('true')
    expect(screen.getByRole('complementary', { name: 'Zone web' })).toBeTruthy()
    expect((await node('guest:zd:qemu/200')).getAttribute('data-parent')).toBe('zone:zd')
  })

  it('leaves the zone when a rendering is picked, the one shown before included', async () => {
    demo()
    await doubleClick('zone:zw')
    await bar()
    fireEvent.click(screen.getByRole('button', { name: 'Groups' }))
    await waitFor(() => expect(screen.queryByTestId('zone-inside-back')).toBeNull())
    expect(pressed('Groups')).toBe('true')
    await doubleClick('zone:zw')
    await bar()
    fireEvent.click(screen.getByRole('button', { name: 'Compact zones' }))
    await waitFor(() => expect(screen.queryByTestId('zone-inside-back')).toBeNull())
    expect(pressed('Compact zones')).toBe('true')
  })

  it('enters another zone from its box, and opens the panel of a box on a click', async () => {
    demo()
    await doubleClick('zone:zw')
    await bar()
    const box = await node('zone:zd')
    fireEvent.click(box)
    expect(screen.getByTestId('node-guest:zw:qemu/100')).toBeTruthy()
    fireEvent.click(box, { detail: 2 })
    expect(await screen.findByRole('complementary', { name: 'Zone db' })).toBeTruthy()
    await waitFor(() => expect(screen.queryByTestId('node-guest:zw:qemu/100')).toBeNull())
    await bar()
    expect((await node('guest:zd:qemu/200')).getAttribute('data-parent')).toBe('zone:zd')
    expect(screen.queryByTestId('node-guest:zw:qemu/100')).toBeNull()
  })

  it('enters the zone of the first click when the second one falls beside it (the map moved under the pointer)', async () => {
    demo()
    const zone = await node('zone:zw')
    fireEvent.click(zone)
    fireEvent.click(screen.getByTestId('flow'), { detail: 2 })
    expect((await bar()).textContent).toBe('Back to the map')
    // The second click did not reach the canvas: the panel of the zone is still open.
    expect(screen.getByRole('complementary', { name: 'Zone web' })).toBeTruthy()
  })

  it('does not enter a zone on a double click that started on a guest, nor on a second click that comes late', async () => {
    demo()
    const web = await node('zone:zw')
    fireEvent.click(await node('guest:zw:qemu/100'))
    fireEvent.click(web, { detail: 2 })
    expect(await screen.findByRole('complementary', { name: 'Zone web' })).toBeTruthy()
    expect(screen.queryByTestId('zone-inside-back')).toBeNull()
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    const late = await node('zone:zd')
    fireEvent.click(late)
    clock.mockReturnValue(now + 5_000)
    fireEvent.click(late, { detail: 2 })
    clock.mockRestore()
    expect(await screen.findByRole('complementary', { name: 'Zone db' })).toBeTruthy()
    expect(screen.queryByTestId('zone-inside-back')).toBeNull()
  })

  it('isolates the flows of a guest picked inside the zone', async () => {
    demo()
    await doubleClick('zone:zw')
    await bar()
    fireEvent.click(await node('guest:zw:qemu/101'))
    expect((await screen.findByTestId('map-isolation')).textContent).toContain('web-2')
    await waitFor(() => expect(screen.queryByTestId('edge-unprotected:guest:zw:qemu/100>zone:zd')).toBeNull())
    expect(await pathOf('unprotected:guest:zw:qemu/100>guest:zw:qemu/101')).toBeTruthy()
  })
})

describe('the button of the zone panel', () => {
  it('enters the zone from a rendering without canvas, and is gone once inside it', async () => {
    window.localStorage.setItem('microseg.map.view', 'matrix')
    demo()
    await screen.findByRole('grid')
    fireEvent.click(screen.getAllByRole('button', { name: 'Open the panel of zone web' })[0])
    const panel = await screen.findByRole('complementary', { name: 'Zone web' })
    fireEvent.click(within(panel).getByRole('button', { name: 'Show the inside of the zone' }))
    expect((await bar()).textContent).toBe('Back to the map')
    expect((await node('guest:zw:qemu/100')).getAttribute('data-parent')).toBe('zone:zw')
    expect(within(screen.getByRole('complementary', { name: 'Zone web' })).queryByRole('button', { name: 'Show the inside of the zone' })).toBeNull()
    // The panel of another zone offers to enter that one.
    fireEvent.click(await node('zone:zd'))
    const other = await screen.findByRole('complementary', { name: 'Zone db' })
    fireEvent.click(within(other).getByRole('button', { name: 'Show the inside of the zone' }))
    await waitFor(() => expect(screen.queryByTestId('node-guest:zw:qemu/100')).toBeNull())
    await bar()
    // Back: the matrix again.
    fireEvent.click(await bar())
    await waitFor(() => expect(screen.queryByTestId('zone-inside-back')).toBeNull())
    expect(pressed('Matrix')).toBe('true')
  })
})
