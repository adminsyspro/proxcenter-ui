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

  it('shows the state of a zone and how many members it has', async () => {
    setup({ zones: [web({ state: 'enforce' })], vms: [vm(100, 'web-1', ['zone-web']), vm(101, 'web-2', ['zone-web'], { status: 'stopped' }), vm(102, 'other', [])] })
    const row = await screen.findByRole('listitem', { name: 'web' })
    expect(within(row).getByText('Enforced')).toBeTruthy()
    expect(await within(row).findByText('2 members · 0 incoming · 0 outgoing')).toBeTruthy()
  })

  it('counts the members, the incoming and the outgoing flows of a zone on its one line', async () => {
    const flows: MicrosegFlow[] = [
      { ...flow('f1'), src_zone_id: 'zw', dst_zone_id: 'zd' },
      { ...flow('f2'), src_zone_id: 'zd', dst_zone_id: 'zw' },
      { ...flow('f3'), src_zone_id: 'zd', dst_zone_id: 'zw', dport: '22' },
    ]
    setup({ zones: [web({ label: 'Front web servers' }), db()], flows, vms: [vm(100, 'web-1', ['zone-web']), vm(101, 'web-2', ['zone-web'])] })
    const row = await screen.findByRole('listitem', { name: 'web' })
    expect(await within(row).findByText('2 members · 2 incoming · 1 outgoing')).toBeTruthy()
    expect(within(row).getByText('Front web servers')).toBeTruthy()
    expect(within(screen.getByRole('listitem', { name: 'db' })).getByText('0 members · 1 incoming · 2 outgoing')).toBeTruthy()
    for (const name of ['Edit zone', 'Change state', 'New flow into web', 'Delete zone']) expect(within(row).getByRole('button', { name })).toBeTruthy()
  })

  it('opens the state menu from the state chip too', async () => {
    setup({ zones: [web()] })
    const row = await screen.findByRole('listitem', { name: 'web' })
    fireEvent.click(within(row).getByText('Observation'))
    expect(await screen.findByRole('menuitem', { name: 'Enforce' })).toBeTruthy()
  })

  it('opens a new flow into the zone from its line, with the zone as destination', async () => {
    setup({ zones: [web(), db()] })
    const row = await screen.findByRole('listitem', { name: 'db' })
    fireEvent.click(within(row).getByRole('button', { name: 'New flow into db' }))
    const dialog = await screen.findByRole('dialog', { name: 'New flow' })
    expect(within(dialog).getByRole('combobox', { name: 'Destination zone' }).textContent).toContain('db')
  })

  it('opens the members and the flows side by side, and remembers it for the zone', async () => {
    const out: MicrosegFlow = { ...flow('f1'), src_zone_id: 'zw', dst_zone_id: 'zd' }
    const view = setup({ zones: [web(), db()], flows: [out], vms: [vm(100, 'web-1', ['zone-web'])] })
    const row = await screen.findByRole('listitem', { name: 'web' })
    fireEvent.click(within(row).getByRole('button', { name: 'Show details' }))
    const members = await within(row).findByRole('region', { name: 'Members' })
    const flowsColumn = within(row).getByRole('region', { name: 'Flows of the zone' })
    expect(members.parentElement).toBe(flowsColumn.parentElement)
    expect(await within(members).findByText('web-1')).toBeTruthy()
    expect(within(members).getByRole('button', { name: 'Assign guests' })).toBeTruthy()
    expect(within(flowsColumn).getByText('Outgoing flows')).toBeTruthy()
    expect(within(flowsColumn).getByRole('button', { name: 'Edit flow' })).toBeTruthy()
    expect(within(flowsColumn).getByRole('button', { name: 'Delete flow' })).toBeTruthy()
    expect(JSON.parse(window.localStorage.getItem('microseg.policy.openZones.c1') ?? '[]')).toEqual(['zw'])

    view.unmount()
    setup({ zones: [web(), db()], flows: [out], vms: [vm(100, 'web-1', ['zone-web'])] })
    const again = await screen.findByRole('listitem', { name: 'web' })
    expect(await within(again).findByText('web-1')).toBeTruthy()
    expect(within(screen.getByRole('listitem', { name: 'db' })).getByRole('button', { name: 'Show details' })).toBeTruthy()
  })

  it('says so when there is no zone', async () => {
    setup()
    expect(await screen.findByText(/No zone yet/)).toBeTruthy()
  })

  it('lists the zone members with StatusIcon under the chevron', async () => {
    setup({
      zones: [web()],
      vms: [vm(100, 'web-1', ['zone-web']), vm(200, 'web-ct', ['zone-web'], { type: 'lxc', status: 'stopped' }), vm(300, 'elsewhere', ['zone-db'])],
      pending_members: [{ id: 'p1', policy_id: 'p1', node: 'pve1', type: 'qemu', vmid: 400, zone_id: 'zw' }],
    })
    const row = await screen.findByRole('listitem', { name: 'web' })
    expect(within(row).queryByText('web-1')).toBeNull()

    fireEvent.click(await within(row).findByRole('button', { name: 'Show details' }))
    expect(await within(row).findByText('web-1')).toBeTruthy()
    expect(within(row).getByText('web-ct')).toBeTruthy()
    expect(within(row).queryByText('elsewhere')).toBeNull()
    expect(within(row).getByText('Pending')).toBeTruthy()
    expect(row.querySelector('i.ri-computer-fill')).toBeTruthy()
    expect(row.querySelector('i.ri-instance-fill')).toBeTruthy()
  })

  it('paginates the members under the chevron', async () => {
    const vms = Array.from({ length: 12 }, (_, i) => vm(100 + i, `web-${String(i).padStart(2, '0')}`, ['zone-web']))
    setup({ zones: [web()], vms })
    const row = await screen.findByRole('listitem', { name: 'web' })
    fireEvent.click(await within(row).findByRole('button', { name: 'Show details' }))
    expect(await within(row).findByText('web-09')).toBeTruthy()
    expect(within(row).queryByText('web-10')).toBeNull()
    expect(within(row).queryByRole('button', { name: /show all/i })).toBeNull()
    fireEvent.click(within(row).getByRole('button', { name: /next page/i }))
    expect(await within(row).findByText('web-10')).toBeTruthy()
    expect(within(row).queryByText('web-00')).toBeNull()
  })

  it('matches the zone tag whatever the case', async () => {
    setup({ zones: [web()], vms: [vm(100, 'upper', ['Zone-Web']), vm(101, 'lower', ['zone-web'])] })
    const row = await screen.findByRole('listitem', { name: 'web' })
    expect(await within(row).findByText(/2 members/)).toBeTruthy()
  })

  it('lists the incoming and outgoing flows of a zone under the chevron', async () => {
    const out: MicrosegFlow = { ...flow('f1'), src_zone_id: 'zw', dst_zone_id: 'zd' }
    const inn: MicrosegFlow = { ...flow('f2'), src_zone_id: 'zd', dst_zone_id: 'zw', dport: '8080' }
    setup({ zones: [web(), db()], flows: [out, inn] })
    const row = await screen.findByRole('listitem', { name: 'web' })
    fireEvent.click(within(row).getByRole('button', { name: 'Show details' }))
    expect(within(row).getByText('Incoming flows')).toBeTruthy()
    expect(within(row).getByText('Outgoing flows')).toBeTruthy()
    expect(within(row).getByText('HTTPS')).toBeTruthy()
    expect(within(row).getByText('HTTP-alt')).toBeTruthy()
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

    const row = screen.getByRole('listitem', { name: 'web' })
    fireEvent.click(within(row).getByRole('button', { name: 'Show details' }))
    expect(within(row).getAllByText(pill)).toHaveLength(1)
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
    expect(within(await screen.findByRole('region', { name: 'Zones' })).queryByRole('button', { name: 'New zone' })).toBeNull()
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
    expect(within(zones).getByRole('button', { name: 'New zone' })).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Flows' })).getByRole('button', { name: 'New flow' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Pre-flight checks' })).toBeTruthy()
  })
})
