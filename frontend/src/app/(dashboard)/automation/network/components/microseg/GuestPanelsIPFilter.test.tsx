/**
 * The "IP filter" section in the two guest panels of the map: above the log in the panel of a guest clicked on the
 * map, between the flows and the rules of the zone in the panel of the guest the map is targeted on; read from the
 * guest's own cluster on a shared policy.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, within } from '@testing-library/react'

import { screen, waitFor } from '@/__tests__/setup/renderWithProviders'

import GuestPanel from './GuestPanel'
import { filterAnswer, filterGuest } from './ipFilterTestKit'
import { BASE, calls, fetchMock, mock, policy, renderTab, reply, resetMocks, zone } from './microsegTestKit'
import TargetPanel from './TargetPanel'
import type { TargetGuest } from './targetModel'
import type { MapMember } from './zoneGraph'

vi.mock('@/lib/api/firewall', () => ({
  getGuestLogPage: async () => ({ total: 0, lines: [] }),
  getGuestLogAfter: async () => ({ total: 0, lines: [] }),
}))

beforeEach(() => {
  resetMocks()
  const base = policy({ zones: [zone('zw', { name: 'web' })] })
  mock.routes['GET /policy'] = () => reply(200, { ...base, policy: { ...base.policy, ip_filter: true, guest_filters: [] } })
  mock.routes['GET /ipfilter'] = () => reply(200, filterAnswer([filterGuest()]))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const sections = (panel: HTMLElement) => [...panel.querySelectorAll('section[data-section]')].map(s => s.getAttribute('data-section'))

describe('the panel of a guest clicked on the map', () => {
  const guest: MapMember = { key: 'qemu/100', name: 'web-1', vmid: 100, node: 'pve1', type: 'qemu', status: 'running', ips: ['10.0.0.5'], pending: false }

  it('has the IP filter above the log', async () => {
    renderTab(<GuestPanel guest={guest} connectionId='c1' onClose={vi.fn()} />)
    const panel = await screen.findByRole('complementary', { name: /web-1/ })
    await waitFor(() => expect(sections(panel)).toEqual(['guest.ipfilter', 'guest.log']))
    await waitFor(() => expect(within(panel).getByTestId('ipfilter-state').textContent).toBe('Filtered'))
    expect(within(panel).getByRole('listitem', { name: 'net0' })).toBeTruthy()
  })

  it('reads the filter of a guest of a shared policy from its own cluster, the policy from the tab connection', async () => {
    const seen: string[] = []
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      seen.push(url)
      if (url === `${BASE.replace('/c1', '/c2')}/ipfilter`) return reply(200, filterAnswer([filterGuest({ applied: false })]))
      const handler = mock.routes[`${init?.method ?? 'GET'} ${url.replace(BASE, '')}`]
      return handler ? handler(init) : reply(404, { code: 'NOT_FOUND', error: 'no mock' })
    })
    renderTab(<GuestPanel guest={{ ...guest, key: 'c2/qemu/100', cluster: { id: 'c2', name: 'DR' } as MapMember['cluster'] }} connectionId='c1' onClose={vi.fn()} />)
    const panel = await screen.findByRole('complementary', { name: /web-1/ })
    await waitFor(() => expect(within(panel).getByTestId('ipfilter-state').textContent).toBe('Will be filtered once a zone is enforced and applied'))
    expect(seen).toContain(`${BASE}/policy`)
    expect(calls('GET /ipfilter')).toHaveLength(0)
  })
})

describe('the panel of the guest the map is targeted on', () => {
  const target: TargetGuest = { id: 'c1/qemu/100', connectionId: 'c1', key: 'qemu/100', vmid: 100, name: 'web-1', type: 'qemu', node: 'pve1', status: 'running', ips: ['10.0.0.5'], zoneId: 'zw' }

  it('has the IP filter after the flows and before the rules of the zone', async () => {
    const web = zone('zw', { name: 'web' })
    renderTab(
      <TargetPanel
        target={target} zonesById={new Map([[web.id, web]])} suggestions={[]} flows={[]} peers={new Map()} connectionId='c1' version={3}
        reloadPolicy={async () => undefined} reloadSuggestions={async () => undefined} onResolved={vi.fn()} onOpenZone={vi.fn()} onClose={vi.fn()}
      />,
    )
    const panel = await screen.findByRole('complementary', { name: /web-1/ })
    await waitFor(() => expect(sections(panel)).toEqual(['guest.guest', 'guest.flows', 'guest.ipfilter', 'guest.zoneRules', 'guest.traffic']))
    await waitFor(() => expect(within(panel).getByTestId('ipfilter-state').textContent).toBe('Filtered'))
    expect(within(panel).getByRole('switch', { name: 'Leave without the filter' })).toBeTruthy()
  })
})
