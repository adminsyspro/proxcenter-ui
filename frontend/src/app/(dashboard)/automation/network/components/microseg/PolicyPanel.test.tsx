/**
 * Policy sub-tab: the zone and flow lists, through the real client (fetch mocked at the Next relay).
 */

import { describe, expect, it } from 'vitest'
import { within } from '@testing-library/react'

import { screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'
import type { MicrosegFlow } from '@/lib/microseg/types'

import { flow, zone } from './microsegTestKit'
import { db, setup, installFreshMocks, vm, web } from './policyTestKit'

installFreshMocks()


describe('zone list', () => {
  it('lists the zones with their state and member count, ten per page', async () => {
    const zones = Array.from({ length: 11 }, (_, i) => zone(`z${i}`, { name: `zone${String(i).padStart(2, '0')}` }))
    setup({ zones })

    // The flow table keeps a group per zone too: the zone list is its own region.
    const list = await screen.findByRole('region', { name: 'Zones' })
    expect(await within(list).findByText('zone00')).toBeTruthy()
    expect(within(list).getByText('zone09')).toBeTruthy()
    expect(within(list).queryByText('zone10')).toBeNull()

    fireEvent.click(within(list).getByRole('button', { name: /next page/i }))
    expect(await within(list).findByText('zone10')).toBeTruthy()
    expect(within(list).queryByText('zone00')).toBeNull()
  })

  it('shows each zone as a card: state, the three counters, a preview of its members and flows', async () => {
    const flows: MicrosegFlow[] = [
      { ...flow('f1'), src_zone_id: 'zw', dst_zone_id: 'zd' },
      { ...flow('f2'), src_zone_id: 'zd', dst_zone_id: 'zw' },
      { ...flow('f3'), src_zone_id: 'zd', dst_zone_id: 'zw', dport: '22' },
      { ...flow('f4'), src_zone_id: '', src_cidr: '10.0.0.0/8', dst_zone_id: 'zw', dport: '80' },
    ]
    const vms = [vm(100, 'web-1', ['zone-web']), vm(101, 'web-2', ['zone-web'], { status: 'stopped' }), vm(102, 'web-3', ['zone-web']), vm(103, 'web-4', ['zone-web']), vm(104, 'other', [])]
    setup({ zones: [web({ state: 'enforce', label: 'Front web servers' }), db()], flows, vms })
    const card = await screen.findByRole('listitem', { name: 'web' })
    expect(within(card).getByText('Enforced')).toBeTruthy()
    expect(within(card).getByText('Front web servers')).toBeTruthy()
    const stat = (c: HTMLElement, name: string) => c.querySelector(`[data-stat="${name}"]`)?.firstElementChild?.textContent
    await waitFor(() => expect(stat(card, 'members')).toBe('4'))
    expect(stat(card, 'incoming')).toBe('3')
    expect(stat(card, 'outgoing')).toBe('1')
    const dbCard = screen.getByRole('listitem', { name: 'db' })
    expect([stat(dbCard, 'members'), stat(dbCard, 'incoming'), stat(dbCard, 'outgoing')]).toEqual(['0', '1', '2'])

    // The first three members (status dot), "+1"; the first three flows in and out, "+1 more flow".
    for (const name of ['web-1', 'web-2', 'web-3']) expect(within(card).getByText(name)).toBeTruthy()
    expect(within(card).queryByText('web-4')).toBeNull()
    expect(within(card).getByText('+1')).toBeTruthy()
    expect(within(card).queryByText('other')).toBeNull()
    const lines = Array.from(card.querySelectorAll('[data-flow-preview]')).map(l => l.textContent)
    expect(lines).toEqual(['db → web HTTPS', 'db → web SSH', '10.0.0.0/8 → web HTTP'])
    expect(within(card).getByText('+1 more flow')).toBeTruthy()

    for (const name of ['Edit zone', 'Change state', 'New flow into web', 'Assign guests', 'Delete zone']) expect(within(card).getByRole('button', { name })).toBeTruthy()
  })

  it('opens the state menu from the state chip too', async () => {
    setup({ zones: [web()] })
    const card = await screen.findByRole('listitem', { name: 'web' })
    fireEvent.click(within(card).getByText('Observation'))
    expect(await screen.findByRole('menuitem', { name: 'Enforce' })).toBeTruthy()
  })

  it('opens a new flow into the zone from its card, with the zone as destination', async () => {
    setup({ zones: [web(), db()] })
    const card = await screen.findByRole('listitem', { name: 'db' })
    fireEvent.click(within(card).getByRole('button', { name: 'New flow into db' }))
    const dialog = await screen.findByRole('dialog', { name: 'New flow' })
    expect(within(dialog).getByRole('combobox', { name: 'Destination zone' }).textContent).toContain('db')
  })

  it('opens the details full width below the row: members and flows side by side, remembered for the zone', async () => {
    const out: MicrosegFlow = { ...flow('f1'), src_zone_id: 'zw', dst_zone_id: 'zd' }
    const view = setup({ zones: [web(), db()], flows: [out], vms: [vm(100, 'web-1', ['zone-web'])] })
    const card = await screen.findByRole('listitem', { name: 'web' })
    expect(screen.queryByRole('region', { name: 'Details of web' })).toBeNull()
    const chevron = within(card).getByRole('button', { name: 'Show details' })
    expect(chevron.textContent).toContain('Details')
    fireEvent.click(chevron)

    const details = await screen.findByRole('region', { name: 'Details of web' })
    expect(chevron.getAttribute('aria-controls')).toBe(details.id)
    expect(card.contains(details)).toBe(false)
    expect(getComputedStyle(details.parentElement as HTMLElement).gridColumn).toMatch(/^1\s*\/\s*-1$/)
    const members = within(details).getByRole('region', { name: 'Members' })
    const flowsColumn = within(details).getByRole('region', { name: 'Flows of the zone' })
    expect(members.parentElement).toBe(flowsColumn.parentElement)
    expect(await within(members).findByText('web-1')).toBeTruthy()
    expect(within(flowsColumn).getByText('Outgoing flows')).toBeTruthy()
    expect(within(flowsColumn).getByRole('button', { name: 'Edit flow' })).toBeTruthy()
    expect(JSON.parse(window.localStorage.getItem('microseg.policy.openZones.c1') ?? '[]')).toEqual(['zw'])

    view.unmount()
    setup({ zones: [web(), db()], flows: [out], vms: [vm(100, 'web-1', ['zone-web'])] })
    expect(await screen.findByRole('region', { name: 'Details of web' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Details of db' })).toBeNull()
  })

  it('says so when there is no zone, with the new-zone card', async () => {
    setup()
    expect(await screen.findByText(/No zone yet/)).toBeTruthy()
    expect(screen.getByTestId('new-zone-card')).toBeTruthy()
  })

  it('ends the grid with a dashed new-zone card that opens the zone dialog', async () => {
    setup({ zones: [web(), db()] })
    const zones = await screen.findByRole('region', { name: 'Zones' })
    const cards = within(zones).getAllByRole('listitem')
    expect(within(cards.at(-1)!).getByTestId('new-zone-card')).toBeTruthy()
    fireEvent.click(screen.getByTestId('new-zone-card'))
    expect(await screen.findByRole('dialog', { name: 'New zone' })).toBeTruthy()
  })

  it('lists the zone members with StatusIcon in the details', async () => {
    setup({
      zones: [web()],
      vms: [vm(100, 'web-1', ['zone-web']), vm(200, 'web-ct', ['zone-web'], { type: 'lxc', status: 'stopped' }), vm(300, 'elsewhere', ['zone-db'])],
      pending_members: [{ id: 'p1', policy_id: 'p1', node: 'pve1', type: 'qemu', vmid: 400, zone_id: 'zw' }],
    })
    const card = await screen.findByRole('listitem', { name: 'web' })
    fireEvent.click(await within(card).findByRole('button', { name: 'Show details' }))
    const details = await screen.findByRole('region', { name: 'Details of web' })
    expect(await within(details).findByText('web-1')).toBeTruthy()
    expect(within(details).getByText('web-ct')).toBeTruthy()
    expect(within(details).queryByText('elsewhere')).toBeNull()
    expect(within(details).getByText('Pending')).toBeTruthy()
    expect(details.querySelector('i.ri-computer-fill')).toBeTruthy()
    expect(details.querySelector('i.ri-instance-fill')).toBeTruthy()
  })

  it('paginates the members in the details', async () => {
    const vms = Array.from({ length: 12 }, (_, i) => vm(100 + i, `web-${String(i).padStart(2, '0')}`, ['zone-web']))
    setup({ zones: [web()], vms })
    const card = await screen.findByRole('listitem', { name: 'web' })
    fireEvent.click(await within(card).findByRole('button', { name: 'Show details' }))
    const details = await screen.findByRole('region', { name: 'Details of web' })
    expect(await within(details).findByText('web-09')).toBeTruthy()
    expect(within(details).queryByText('web-10')).toBeNull()
    fireEvent.click(within(details).getByRole('button', { name: /next page/i }))
    expect(await within(details).findByText('web-10')).toBeTruthy()
    expect(within(details).queryByText('web-00')).toBeNull()
  })

  it('matches the zone tag whatever the case', async () => {
    setup({ zones: [web()], vms: [vm(100, 'upper', ['Zone-Web']), vm(101, 'lower', ['zone-web'])] })
    const card = await screen.findByRole('listitem', { name: 'web' })
    await waitFor(() => expect(card.querySelector('[data-stat="members"]')?.firstElementChild?.textContent).toBe('2'))
  })

  it('lists the incoming and outgoing flows of a zone in the details', async () => {
    const out: MicrosegFlow = { ...flow('f1'), src_zone_id: 'zw', dst_zone_id: 'zd' }
    const inn: MicrosegFlow = { ...flow('f2'), src_zone_id: 'zd', dst_zone_id: 'zw', dport: '8080' }
    setup({ zones: [web(), db()], flows: [out, inn] })
    const card = await screen.findByRole('listitem', { name: 'web' })
    fireEvent.click(within(card).getByRole('button', { name: 'Show details' }))
    const details = await screen.findByRole('region', { name: 'Details of web' })
    expect(within(details).getByText('Incoming flows')).toBeTruthy()
    expect(within(details).getByText('Outgoing flows')).toBeTruthy()
    expect(within(details).getByText('HTTPS')).toBeTruthy()
    expect(within(details).getByText('HTTP-alt')).toBeTruthy()
  })

  it('chips the drifts of a zone and opens the Drifts sub-tab on them', async () => {
    const { mock, reply } = await import('./microsegTestKit')
    mock.routes['GET /drifts'] = () => reply(200, { computed: true, drifts: [{ kind: 'nic_firewall_off', guest: { node: 'pve1', type: 'qemu', vmid: 100 } }] })
    setup({ zones: [web(), db()], vms: [vm(100, 'web-1', ['zone-web'])] })
    const card = await screen.findByRole('listitem', { name: 'web' })
    const chip = await within(card).findByText('1 drift')
    expect(within(screen.getByRole('listitem', { name: 'db' })).queryByText(/drift/)).toBeNull()
    fireEvent.click(chip)
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Drifts' }).getAttribute('aria-selected')).toBe('true'))
  })
})

describe('flow list', () => {
  it('explains why New flow is disabled while there is no zone', async () => {
    setup()
    const button = await screen.findByRole('button', { name: 'New flow' })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    fireEvent.mouseOver(button.parentElement as HTMLElement)
    expect(await screen.findByText('Create a zone first: a flow links zones or a zone and a CIDR.')).toBeTruthy()
  })

  it('says "not applied in v1" for a flow whose destination is a CIDR, in the table and under the zone', async () => {
    const toCidr: MicrosegFlow = { ...flow('f1'), src_zone_id: 'zw', dst_zone_id: '', dst_cidr: '10.0.0.0/8', dport: '53', proto: 'udp' }
    const toZone: MicrosegFlow = { ...flow('f2'), src_zone_id: 'zw', dst_zone_id: 'zd' }
    setup({ zones: [web(), db()], flows: [toCidr, toZone] })

    const pill = 'Not applied (egress not managed in v1)'
    const flows = await screen.findByRole('region', { name: 'Flows' })
    expect(within(flows).getAllByText('Not applied in v1')).toHaveLength(1)
    expect(within(flows).getByText('10.0.0.0/8')).toBeTruthy()

    fireEvent.click(within(screen.getByRole('listitem', { name: 'web' })).getByRole('button', { name: 'Show details' }))
    expect(within(await screen.findByRole('region', { name: 'Details of web' })).getAllByText(pill)).toHaveLength(1)
  })

  it('does not show the pill for a CIDR source', async () => {
    const fromCidr: MicrosegFlow = { ...flow('f1'), src_zone_id: '', src_cidr: '10.0.0.0/8', dst_zone_id: 'zw' }
    setup({ zones: [web()], flows: [fromCidr] })
    const flows = await screen.findByRole('region', { name: 'Flows' })
    expect(within(flows).getByText('10.0.0.0/8')).toBeTruthy()
    expect(within(flows).queryByText(/Not applied/)).toBeNull()
  })

  it('paginates the flows', async () => {
    const flows = Array.from({ length: 11 }, (_, i) => ({ ...flow(`f${i}`), src_zone_id: 'zw', dst_zone_id: 'zd', dport: String(42000 + i) }))
    setup({ zones: [web(), db()], flows })
    const region = await screen.findByRole('region', { name: 'Flows' })
    expect(within(region).getByText('tcp/42009')).toBeTruthy()
    expect(within(region).queryByText('tcp/42010')).toBeNull()
    fireEvent.click(within(region).getByRole('button', { name: /next page/i }))
    expect(await within(region).findByText('tcp/42010')).toBeTruthy()

    // A new filter starts the group again on its first page.
    fireEvent.change(within(region).getByRole('textbox', { name: 'Filter by zone or service' }), { target: { value: 'tcp' } })
    expect(await within(region).findByText('tcp/42000')).toBeTruthy()
    expect(within(region).queryByText('tcp/42010')).toBeNull()
  })
})


describe('actions row', () => {
  it('puts Pre-flight checks, New zone and New flow on the row of the sub-tabs, in that order, before Emergency stop', async () => {
    setup({ zones: [web()] })
    const slot = await screen.findByTestId('microseg-actions-slot')
    await waitFor(() => expect(within(slot).getAllByRole('button').map(b => b.textContent)).toEqual(['Pre-flight checks', 'New zone', 'New flow']))
    const row = slot.parentElement as HTMLElement
    const names = within(row).getAllByRole('button').map(b => b.getAttribute('aria-label') ?? b.textContent)
    expect(names.indexOf('New flow')).toBeLessThan(names.findIndex(n => /Emergency stop/.test(n ?? '')))
    // In the Zones region only the dashed card leads to a new zone (its button sits on the row of the sub-tabs).
    const inRegion = within(await screen.findByRole('region', { name: 'Zones' })).getAllByRole('button', { name: 'New zone' })
    expect(inRegion).toEqual([screen.getByTestId('new-zone-card')])
    expect(screen.getByText('Zones')).toBeTruthy()
    expect(screen.getByText('Flows')).toBeTruthy()
  })

  it('keeps the buttons working from the row', async () => {
    setup({ zones: [web()] })
    const slot = await screen.findByTestId('microseg-actions-slot')
    fireEvent.click(await within(slot).findByRole('button', { name: 'New zone' }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })

  it('keeps the buttons in their sections when the panel is rendered without a tab row', async () => {
    const { policy: makePolicy } = await import('./microsegTestKit')
    const { default: PolicyPanel } = await import('./PolicyPanel')
    const { renderWithProviders } = await import('@/__tests__/setup/renderWithProviders')
    renderWithProviders(
      <PolicyPanel connectionId='c1' policy={makePolicy({ zones: [web()] })} reloadPolicy={async () => undefined} goToSubTab={() => undefined} onOpenPlan={() => undefined} startRun={() => undefined} onOpenPreflight={() => undefined} />,
    )
    const zones = await screen.findByRole('region', { name: 'Zones' })
    expect(within(zones).getByTestId('new-zone-card')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Flows' })).getByRole('button', { name: 'New flow' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Pre-flight checks' })).toBeTruthy()
  })
})
