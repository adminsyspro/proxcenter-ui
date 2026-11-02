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

    expect(await screen.findByText('zone00')).toBeTruthy()
    expect(screen.getByText('zone09')).toBeTruthy()
    expect(screen.queryByText('zone10')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /next page/i }))
    expect(await screen.findByText('zone10')).toBeTruthy()
    expect(screen.queryByText('zone00')).toBeNull()
  })

  it('shows the state of a zone and how many members it has', async () => {
    setup({ zones: [web({ state: 'enforce' })], vms: [vm(100, 'web-1', ['zone-web']), vm(101, 'web-2', ['zone-web'], { status: 'stopped' }), vm(102, 'other', [])] })
    const row = await screen.findByRole('listitem', { name: 'web' })
    expect(within(row).getByText('Enforced')).toBeTruthy()
    expect(await within(row).findByText(/2 members, 1 running/)).toBeTruthy()
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

  it('lists the incoming and outgoing flows of a zone under the chevron', async () => {
    const out: MicrosegFlow = { ...flow('f1'), src_zone_id: 'zw', dst_zone_id: 'zd' }
    const inn: MicrosegFlow = { ...flow('f2'), src_zone_id: 'zd', dst_zone_id: 'zw', dport: '8080' }
    setup({ zones: [web(), db()], flows: [out, inn] })
    const row = await screen.findByRole('listitem', { name: 'web' })
    fireEvent.click(within(row).getByRole('button', { name: 'Show details' }))
    expect(within(row).getByText('Incoming flows')).toBeTruthy()
    expect(within(row).getByText('Outgoing flows')).toBeTruthy()
    expect(within(row).getByText('tcp/443')).toBeTruthy()
    expect(within(row).getByText('tcp/8080')).toBeTruthy()
  })
})

describe('flow list', () => {
  it('shows the pill "not applied" on a flow whose destination is a CIDR, in the list and under the zone', async () => {
    const toCidr: MicrosegFlow = { ...flow('f1'), src_zone_id: 'zw', dst_zone_id: '', dst_cidr: '10.0.0.0/8', dport: '53', proto: 'udp' }
    const toZone: MicrosegFlow = { ...flow('f2'), src_zone_id: 'zw', dst_zone_id: 'zd' }
    setup({ zones: [web(), db()], flows: [toCidr, toZone] })

    const pill = 'Not applied (egress not managed in v1)'
    const flows = await screen.findByRole('region', { name: 'Flows' })
    expect(within(flows).getAllByText(pill)).toHaveLength(1)
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
    const flows = Array.from({ length: 11 }, (_, i) => ({ ...flow(`f${i}`), src_zone_id: 'zw', dst_zone_id: 'zd', dport: String(1000 + i) }))
    setup({ zones: [web(), db()], flows })
    const region = await screen.findByRole('region', { name: 'Flows' })
    expect(within(region).getByText('tcp/1009')).toBeTruthy()
    expect(within(region).queryByText('tcp/1010')).toBeNull()
    fireEvent.click(within(region).getByRole('button', { name: /next page/i }))
    expect(await within(region).findByText('tcp/1010')).toBeTruthy()
  })
})

