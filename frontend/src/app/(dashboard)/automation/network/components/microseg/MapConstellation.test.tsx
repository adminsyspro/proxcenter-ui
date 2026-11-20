/**
 * Overview sub-tab, the constellation rendering: a pastille per zone on a turning sphere, nothing in the centre of the
 * map, the flows as arcs; the zone, edge and guest panels it opens, a zone entered by a double click, the way back,
 * the flow checkboxes, its own controls and `prefers-reduced-motion`.
 */

import { describe, expect, it } from 'vitest'

import { screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'

import { db, installFreshMocks, vm, web } from './policyTestKit'
import { flowOf, reduceMotion, setup, wouldBlock } from './zoneMapTestKit'
import { zone } from './microsegTestKit'

installFreshMocks()

const guests = [
  vm(100, 'web-1', ['zone-web'], { ips: ['10.0.0.1'] }),
  vm(101, 'web-2', ['zone-web'], { ips: ['10.0.0.3'] }),
  vm(200, 'db-1', ['zone-db'], { ips: ['10.0.0.2'] }),
  vm(300, 'lost', [], { ips: ['10.0.9.9'] }),
]
const observed = [
  wouldBlock('s1', { src_ip: '10.0.0.1', dst_ip: '10.0.0.2', hits: 5 }),
  wouldBlock('s2', { kind: 'blocked', src_ip: '10.0.0.3', dst_ip: '10.0.0.2', dport: '22', hits: 7 }),
]

function demo() {
  window.localStorage.setItem('microseg.map.view', 'constellation')
  return setup({ vms: guests, flows: [flowOf('f1')], suggestions: observed })
}
const star = (id: string) => document.querySelector(`[data-star="${id}"]`) as HTMLElement | null
const findStar = (id: string) => waitFor(() => { const s = star(id); expect(s).toBeTruthy(); return s! })
const arcs = () => [...document.querySelectorAll('[data-arc]')] as HTMLElement[]
const centre = () => screen.queryByTestId('constellation-centre')

describe('the constellation rendering', () => {
  it('is the second rendering of the toolbar, kept in the browser', async () => {
    demo()
    const button = await screen.findByRole('button', { name: 'Constellation' })
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(await screen.findByTestId('zone-constellation')).toBeTruthy()
  })

  it('draws a pastille per zone, the guests in no zone and Unknown / External, nothing in the centre, the flows as arcs', async () => {
    demo()
    await findStar('zone:zw')
    expect(star('zone:zd')).toBeTruthy()
    expect(star('unzoned')).toBeTruthy()
    expect(star('zone:zw')!.getAttribute('aria-label')).toBe('Zone web, Observation, 2 members')
    expect(centre()).toBeNull()
    await waitFor(() => expect(arcs().map(a => a.dataset.kind).sort((a, b) => a!.localeCompare(b!))).toEqual(['allowed', 'blocked', 'unprotected']))
  })

  it('opens the zone panel on a click, the flow panel on an arc, and lights the flows of a pastille under the pointer', async () => {
    demo()
    fireEvent.click(await findStar('zone:zw'))
    expect(await screen.findByRole('complementary', { name: 'Zone web' })).toBeTruthy()
    const allowed = arcs().find(a => a.dataset.kind === 'allowed')!
    fireEvent.click(allowed)
    expect(await screen.findByRole('complementary', { name: 'Flow web to db' })).toBeTruthy()
    fireEvent.pointerEnter(star('zone:zd')!)
    await waitFor(() => expect(arcs().filter(a => a.dataset.lit === 'true').length).toBeGreaterThan(0))
  })

  it('opens the zone panel from the keyboard', async () => {
    demo()
    fireEvent.keyDown(await findStar('zone:zd'), { key: 'Enter' })
    expect(await screen.findByRole('complementary', { name: 'Zone db' })).toBeTruthy()
  })

  it('enters a zone on a double click: the zone in the centre, its guests around, the guest panel on a click, then back to the map', async () => {
    demo()
    const web1 = await findStar('zone:zw')
    fireEvent.click(web1, { detail: 1 })
    fireEvent.click(web1, { detail: 2 })
    await waitFor(() => expect(centre()?.textContent).toContain('web'))
    expect(await findStar('guest:zw:qemu/100')).toBeTruthy()
    expect(star('guest:zw:qemu/101')).toBeTruthy()
    // The other zone is on the outer orbit.
    expect(star('zone:zd')).toBeTruthy()
    fireEvent.click(star('guest:zw:qemu/100')!)
    expect(await screen.findByRole('complementary', { name: 'Guest web-1' })).toBeTruthy()
    fireEvent.click(screen.getByTestId('zone-inside-back'))
    await waitFor(() => expect(centre()).toBeNull())
    expect(star('guest:zw:qemu/100')).toBeNull()
  })

  it('follows the flow checkboxes of the toolbar', async () => {
    demo()
    await findStar('zone:zw')
    await waitFor(() => expect(arcs()).toHaveLength(3))
    fireEvent.click(screen.getByRole('checkbox', { name: /^Allowed$/ }))
    await waitFor(() => expect(arcs().map(a => a.dataset.kind).sort((a, b) => a!.localeCompare(b!))).toEqual(['blocked', 'unprotected']))
  })

  it('zooms, fits and stops its slow turn from its own controls', async () => {
    demo()
    const scene = await screen.findByTestId('zone-constellation')
    expect(scene.dataset.turning).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    fireEvent.click(screen.getByRole('button', { name: 'Fit the map to the view' }))
    fireEvent.click(screen.getByRole('button', { name: 'Stop the rotation' }))
    await waitFor(() => expect(scene.dataset.turning).toBe('false'))
    expect(screen.getByRole('button', { name: 'Resume the rotation' }).getAttribute('aria-pressed')).toBe('true')
    // A drag turns the scene and opens nothing.
    fireEvent.pointerDown(scene, { button: 0, clientX: 100, clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(scene, { clientX: 160, clientY: 120, pointerId: 1 })
    fireEvent.pointerUp(scene, { pointerId: 1 })
    fireEvent.click(scene)
    expect(screen.queryByRole('complementary')).toBeNull()
    fireEvent.wheel(scene, { deltaY: -200 })
  })

  it('does not turn on its own, and offers no rotation button, with reduced motion', async () => {
    reduceMotion()
    demo()
    const scene = await screen.findByTestId('zone-constellation')
    expect(scene.dataset.turning).toBe('false')
    expect(screen.queryByRole('button', { name: 'Stop the rotation' })).toBeNull()
    expect(document.querySelector('[data-arc] circle')).toBeNull()
  })

  it('draws a zone with no colour with the divider of the theme, and a disabled zone paler', async () => {
    window.localStorage.setItem('microseg.map.view', 'constellation')
    setup({ zones: [web({ color: '' }), db({ state: 'disabled' }), zone('za', { name: 'app' })], vms: guests, flows: [flowOf('f1')], suggestions: [] })
    expect((await findStar('zone:zd')).dataset.dim).toBe('0.65')
    expect(star('zone:zw')!.dataset.dim).toBe('1')
  })
})
