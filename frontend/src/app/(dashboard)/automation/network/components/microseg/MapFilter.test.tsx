/**
 * Overview, "Filter the map" with several picks: zones, Proxmox nodes and guests added one after the other as chips,
 * the map reduced to them and the flows between them, "With what they exchange with", the matrix, the guest view
 * centred on a zone picked, removing a pick, and the field on one line with the "+N" of the chips past two.
 */

import { describe, expect, it } from 'vitest'
import { within } from '@testing-library/react'

import { screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'

import { zone } from './microsegTestKit'
import { db, installFreshMocks, vm, web } from './policyTestKit'
import { flowOf, node, setup, wouldBlock } from './zoneMapTestKit'

installFreshMocks()

const app = () => zone('za', { name: 'app', color: '#f59e0b' })
const guests = [
  vm(100, 'web-1', ['zone-web'], { ips: ['10.0.0.1'], node: 'pve1' }),
  vm(200, 'db-1', ['zone-db'], { ips: ['10.0.0.2'], node: 'pve2' }),
  vm(300, 'app-1', ['zone-app'], { ips: ['10.0.0.4'], node: 'pve2' }),
]
const demo = () => setup({
  zones: [web(), db(), app()], vms: guests,
  flows: [flowOf('f1'), flowOf('f2', { src_zone_id: 'za', dst_zone_id: 'zw', dport: '8080' })],
  suggestions: [wouldBlock('s1', { src_ip: '10.0.0.1', dst_ip: '10.0.0.2', hits: 5 })],
})

const field = () => screen.getByRole('combobox', { name: 'Filter the map' })
async function add(text: string, option: RegExp) {
  field().focus()
  fireEvent.keyDown(field(), { key: 'ArrowDown' })
  fireEvent.change(field(), { target: { value: text } })
  fireEvent.click(await screen.findByRole('option', { name: option }))
}
const chips = () => [...document.querySelectorAll('.MuiAutocomplete-root .MuiChip-root')].map(c => `${(c as HTMLElement).dataset.kind}:${c.textContent}`)
const peers = () => screen.queryByRole('checkbox', { name: 'With what they exchange with' })
const drawn = (id: string) => screen.queryByTestId(`node-${id}`)

describe('the filter of the map', () => {
  it('lists the zones, the Proxmox nodes with their guests and the guests, each under the heading of its kind', async () => {
    demo()
    await node('zone:zw')
    field().focus()
    fireEvent.keyDown(field(), { key: 'ArrowDown' })
    const options = await screen.findAllByRole('option')
    expect(options.map((o: HTMLElement) => o.getAttribute('aria-label'))).toEqual([
      'app, zone', 'db, zone', 'web, zone',
      'pve1, Proxmox node, 1 running guest', 'pve2, Proxmox node, 2 running guests',
      'app-1, guest 300, app', 'db-1, guest 200, db', 'web-1, guest 100, web',
    ])
    expect(screen.getByText('Zones')).toBeTruthy()
    expect(screen.getByText('Proxmox nodes')).toBeTruthy()
    expect(screen.getByText('Guests')).toBeTruthy()
  })

  it('keeps two zones and the flows between them only, then what they exchange with once asked, the picks ringed', async () => {
    demo()
    await node('zone:za')
    await add('web', /^web, zone$/)
    await add('db', /^db, zone$/)
    expect(chips()).toEqual(['zone:web', 'zone:db'])
    await waitFor(() => expect(drawn('zone:za')).toBeNull())
    expect(drawn('zone:zw')).toBeTruthy()
    expect(drawn('zone:zd')).toBeTruthy()
    // One guest picked or more: no target chip, no guest panel.
    expect(screen.queryByText(/^Targeting /)).toBeNull()

    fireEvent.click(peers()!)
    expect(await node('zone:za')).toBeTruthy()
    expect(drawn('zone:zw')!.getAttribute('class')).toContain('microseg-target')
    expect(drawn('zone:za')!.getAttribute('class') ?? '').not.toContain('microseg-target')
  })

  it('keeps a zone alone with what it exchanges with', async () => {
    demo()
    await node('zone:za')
    await add('app', /^app, zone$/)
    expect(peers()).toBeNull()
    await waitFor(() => expect(drawn('zone:zd')).toBeNull())
    expect(drawn('zone:za')).toBeTruthy()
    expect(drawn('zone:zw')).toBeTruthy()
  })

  it('keeps the guests of a picked Proxmox node, and the map whole again once the picks are removed', async () => {
    demo()
    await node('zone:za')
    await add('pve1', /^pve1, Proxmox node/)
    await add('db', /^db, zone$/)
    await waitFor(() => expect(drawn('zone:za')).toBeNull())
    expect(drawn('guest:zw:qemu/100')).toBeTruthy()
    // The cross of each chip removes it.
    for (const chip of [...document.querySelectorAll('.MuiAutocomplete-root .MuiChip-deleteIcon')].reverse()) fireEvent.click(chip)
    await waitFor(() => expect(chips()).toEqual([]))
    expect(await node('zone:za')).toBeTruthy()
  })

  it('counts the chips past the second one while the field is not used', async () => {
    demo()
    await node('zone:za')
    await add('web', /^web, zone$/)
    await add('db', /^db, zone$/)
    await add('app', /^app, zone$/)
    field().blur()
    fireEvent.blur(field())
    await waitFor(() => expect(within(field().closest('.MuiAutocomplete-root') as HTMLElement).getByText('+1')).toBeTruthy())
    expect(chips()).toEqual(['zone:web', 'zone:db'])
  })

  it('reduces the matrix to the zones picked', async () => {
    demo()
    await node('zone:za')
    fireEvent.click(screen.getByRole('button', { name: 'Matrix' }))
    await add('web', /^web, zone$/)
    await add('db', /^db, zone$/)
    const grid = await screen.findByRole('grid')
    await waitFor(() => expect(within(grid).queryByRole('rowheader', { name: /app/ })).toBeNull())
    expect(within(grid).getAllByRole('rowheader').map(h => h.textContent?.trim().split(/\s/)[0])).toEqual(['db', 'web'])
  })

  it('centres the guest view on the first zone picked', async () => {
    demo()
    await node('zone:za')
    fireEvent.click(screen.getByRole('button', { name: 'Guest view' }))
    await add('app', /^app, zone$/)
    const centre = await screen.findByRole('combobox', { name: 'Zone in the centre' })
    await waitFor(() => expect(centre.textContent).toContain('app'))
  })
})
