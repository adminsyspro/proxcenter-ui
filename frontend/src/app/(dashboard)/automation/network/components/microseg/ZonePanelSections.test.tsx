/**
 * Overview sub-tab, the panels of the map (UA56): as tall as the map, their content in foldable sections remembered
 * per browser; the zone panel charts the flows logged in the zone (the Dashboard's chart filtered on it), says its
 * posture (members, NIC firewall off, drifts with a way to them), its top sources, and resolves its pending
 * suggestions through the draft as the map's flow panel does.
 */

import { describe, expect, it } from 'vitest'
import { within } from '@testing-library/react'

import { screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'

import { calls, mock, reply } from './microsegTestKit'
import { PANEL_SECTIONS_KEY } from './PanelSection'
import { body, installFreshMocks, vm } from './policyTestKit'
import { node, setup, wouldBlock } from './zoneMapTestKit'

installFreshMocks()

const EVENTS_OF_DB = 'GET /events?limit=500&zone=db'

let seq = 900
const event = (src_zone: string, over: Record<string, unknown> = {}) => ({
  seq: seq--, ts: new Date(Date.now() - 60_000).toISOString(), node: 'pve1', vmid: 101, type: 'qemu', guest: 'db1', zone: 'db', src_zone,
  src_ip: src_zone ? '10.0.0.5' : '203.0.113.9', dst_ip: '10.0.0.2', proto: 'tcp', dport: 5432, verdict: 'would_block', ...over,
})

async function openDb() {
  fireEvent.click(await node('zone:zd'))
  return screen.findByRole('complementary', { name: 'Zone db' })
}

const section = (panel: HTMLElement, name: string) => within(panel).getByRole('region', { name })

describe('zone panel sections', () => {
  it('splits the panel in foldable sections with their counts, the body scrolling under a fixed header', async () => {
    setup({ suggestions: [wouldBlock('s1')], vms: [vm(101, 'db1', ['zone-db'])] })
    const panel = await openDb()

    const titles = [...panel.querySelectorAll('section[data-section]')].map(s => s.getAttribute('aria-label'))
    expect(titles).toEqual(['Observed traffic', 'Posture', 'Top sources', 'Pending suggestions', 'Members', 'Incoming flows', 'Outgoing flows'])
    await waitFor(() => expect(within(panel).getByTestId('section-zone.members').textContent).toContain('1'))
    expect(within(panel).getByTestId('section-zone.suggestions').textContent).toContain('1')
    expect(within(panel).getByTestId('panel-body')).toBeTruthy()
  })

  it('folds a section, and keeps it folded when the panel opens again', async () => {
    setup({ vms: [vm(101, 'db1', ['zone-db'])] })
    let panel = await openDb()
    expect(await within(panel).findByText('db1')).toBeTruthy()

    fireEvent.click(within(panel).getByTestId('section-zone.members'))
    await waitFor(() => expect(within(panel).queryByText('db1')).toBeNull())
    expect(JSON.parse(window.localStorage.getItem(PANEL_SECTIONS_KEY) ?? '[]')).toEqual(['zone.members'])

    fireEvent.click(within(panel).getByRole('button', { name: 'Close' }))
    panel = await openDb()
    expect(within(panel).getByTestId('section-zone.members').getAttribute('aria-expanded')).toBe('false')
    expect(within(panel).queryByText('db1')).toBeNull()
    fireEvent.click(within(panel).getByTestId('section-zone.members'))
    expect(await within(panel).findByText('db1')).toBeTruthy()
    expect(JSON.parse(window.localStorage.getItem(PANEL_SECTIONS_KEY) ?? '[]')).toEqual([])
  })
})

describe('zone panel: Posture', () => {
  it('counts the members running and stopped, those with their NIC firewall off, and the drifts of the zone', async () => {
    mock.routes['GET /drifts'] = () => reply(200, {
      computed: true,
      drifts: [
        { kind: 'nic_firewall_off', guest: { node: 'pve1', type: 'qemu', vmid: 101 } },
        { kind: 'ipset_out_of_sync', object: 'pcz-db', detail: { zone: 'zd' } },
        { kind: 'nic_firewall_off', guest: { node: 'pve1', type: 'qemu', vmid: 300 } },
      ],
    })
    setup({ vms: [vm(101, 'db1', ['zone-db']), vm(102, 'db2', ['zone-db'], { status: 'stopped' }), vm(300, 'other', [])] })
    const panel = await openDb()
    const posture = section(panel, 'Posture')

    await waitFor(() => expect(within(posture).getByTestId('posture-members').textContent).toBe('1 running, 1 stopped'))
    expect(await within(posture).findByText('1 member with its NIC firewall off')).toBeTruthy()
    expect(within(posture).getByTestId('posture-drifts').textContent).toBe('2 drifts')

    fireEvent.click(within(posture).getByRole('button', { name: 'Open Drifts' }))
    expect((await screen.findByTestId('drifts-zone-filter')).textContent).toContain('db')
  })
})

describe('zone panel: Observed traffic and Top sources', () => {
  it('charts the events logged in the zone (asked with zone=), stacked by source zone, and ranks its sources with their share', async () => {
    mock.routes[EVENTS_OF_DB] = () => reply(200, {
      events: [event('web'), event('web'), event('web', { verdict: 'blocked' }), event('')], truncated: false, oldest: null,
    })
    setup()
    const panel = await openDb()

    const traffic = section(panel, 'Observed traffic')
    await waitFor(() => expect(within(traffic).getAllByTestId(/^area-/).map(a => a.getAttribute('data-testid'))).toEqual(['area-zone:zw', 'area-external']))
    expect(calls(EVENTS_OF_DB).length).toBeGreaterThan(0)
    expect(within(traffic).getByTestId('traffic-summary').textContent).toBe('4 hits · top source web (75%) · 3 would be blocked, 1 blocked')
    expect(within(traffic).getByTestId('timeline-legend').textContent).toContain('web')

    const rows = within(section(panel, 'Top sources')).getAllByRole('listitem')
    expect(rows.map(r => r.getAttribute('data-source'))).toEqual(['zone:zw', 'external'])
    expect(rows[0].textContent).toContain('75%')
    expect(rows[1].textContent).toContain('Unknown / External')
    expect(rows[1].textContent).toContain('25%')
  })
})

describe('zone panel: Pending suggestions', () => {
  it('lists the learned flows towards the zone and accepts one through the draft', async () => {
    mock.routes['POST /suggestions/resolve'] = () => reply(200, { version: 4 })
    setup({ suggestions: [wouldBlock('s1', { hits: 9 }), wouldBlock('s2', { dst_zone_id: 'zw', src_zone_id: 'zd' })] })
    const panel = await openDb()
    const pending = section(panel, 'Pending suggestions')

    const line = within(pending).getByRole('listitem', { name: 'web' })
    expect(within(pending).getAllByRole('listitem')).toHaveLength(1)
    fireEvent.click(within(line).getByRole('button', { name: 'Accept' }))

    await waitFor(() => expect(calls('POST /suggestions/resolve')).toHaveLength(1))
    expect(body(calls('POST /suggestions/resolve')[0][1] as RequestInit)).toEqual({ version: 3, ids: ['s1'], action: 'accept' })
  })
})
