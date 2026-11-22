/**
 * The lines of the banner about the IP filter: off while a zone is enforced (with "Turn on", a draft change), and the
 * guests outside every zone on the network of an enforced zone (with the way to the Drifts sub-tab).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, within } from '@testing-library/react'

import { fireEvent, screen, waitFor } from '@/__tests__/setup/renderWithProviders'
import RBACContext, { type RBACContextValue } from '@/contexts/RBACContext'
import type { MicrosegDrift, MicrosegZone } from '@/lib/microseg/types'

import { unzonedSameNetwork } from './IPFilterBanner'
import { REVISION_HEAD, calls, mock, policy, renderTab, reply, resetMocks, zone } from './microsegTestKit'
import MicrosegTab from './MicrosegTab'

beforeEach(resetMocks)
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const ENFORCED = [zone('zw', { name: 'web', state: 'enforce' }), zone('zd', { name: 'db' })]
const stray = (vmid: number): MicrosegDrift => ({ kind: 'unzoned_same_network', guest: { node: 'pve1', type: 'qemu', vmid }, detail: { name: `stray-${vmid}`, networks: ['vmbr0/20'], zones: ['web'] } })

function setPolicy(ipFilter: boolean | undefined, zones: MicrosegZone[] = ENFORCED, version = 3) {
  const base = policy({ zones, last_revision: REVISION_HEAD, version })
  mock.routes['GET /policy'] = () => reply(200, { ...base, policy: ipFilter === undefined ? base.policy : { ...base.policy, ip_filter: ipFilter, guest_filters: [] } })
}

const body = (key: string) => JSON.parse(String((calls(key)[0][1] as RequestInit).body))
const ready = () => screen.findByRole('button', { name: 'Emergency stop' })

describe('the IP filter is off while a zone is enforced', () => {
  it('says so on one line and turns it on with the draft version, then reads the draft again', async () => {
    setPolicy(false)
    mock.routes['PUT /policy'] = () => {
      setPolicy(true)
      return reply(200, { version: 4 })
    }
    renderTab()
    const line = await screen.findByTestId('ipfilter-banner-off')
    expect(line.textContent).toBe('The IP filter is off: a member can send with the address of a member of another zone.Turn on')
    fireEvent.click(within(line).getByRole('button', { name: 'Turn on' }))
    await waitFor(() => expect(calls('PUT /policy')).toHaveLength(1))
    expect(body('PUT /policy')).toEqual({ version: 3, ip_filter: true })
    await waitFor(() => expect(screen.queryByTestId('ipfilter-banner-off')).toBeNull())
  })

  it('shows the refusal under the line and keeps the line', async () => {
    setPolicy(false)
    mock.routes['PUT /policy'] = () => reply(409, { code: 'VERSION_CONFLICT', error: 'stale' })
    renderTab()
    fireEvent.click(within(await screen.findByTestId('ipfilter-banner-off')).getByRole('button', { name: 'Turn on' }))
    await waitFor(() => expect(calls('PUT /policy')).toHaveLength(1))
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0))
    expect(screen.getByTestId('ipfilter-banner-off')).toBeTruthy()
  })

  it('offers no button to a read-only user', async () => {
    setPolicy(false)
    const readOnly: RBACContextValue = {
      permissions: [], roles: [], isAdmin: false, scopeTypes: [], hiddenWidgets: [], loading: false,
      hasPermission: () => false, hasAnyPermission: () => false, hasAllPermissions: () => false, hasPermissionOn: () => false, refresh: () => undefined,
    }
    renderTab(<RBACContext.Provider value={readOnly}><MicrosegTab connectionId='c1' /></RBACContext.Provider>)
    const line = await screen.findByTestId('ipfilter-banner-off')
    expect(within(line).queryByRole('button')).toBeNull()
  })

  it.each([
    ['no zone is enforced', false, [zone('zw', { name: 'web' })]],
    ['the filter is on', true, ENFORCED],
    ['the orchestrator does not know the filter', undefined, ENFORCED],
  ] as Array<[string, boolean | undefined, MicrosegZone[]]>)('says nothing when %s', async (_name, ipFilter, zones) => {
    setPolicy(ipFilter, zones)
    mock.routes['GET /drifts'] = () => reply(200, { drifts: [], computed: true })
    renderTab()
    await ready()
    await waitFor(() => expect(calls('GET /status').length).toBeGreaterThan(0))
    expect(screen.queryByTestId('ipfilter-banner')).toBeNull()
  })
})

describe('guests outside every zone on the network of an enforced zone', () => {
  it('counts them from the drifts and goes to the Drifts sub-tab', async () => {
    setPolicy(true)
    mock.routes['GET /drifts'] = () => reply(200, { drifts: [stray(1), stray(2), { kind: 'nic_firewall_off', guest: { node: 'pve1', type: 'qemu', vmid: 9 } }], computed: true })
    renderTab()
    const line = await screen.findByTestId('ipfilter-banner-unzoned')
    expect(line.textContent).toBe('2 guests outside every zone share the network of an enforced zone: they are not filtered.See the drifts')
    fireEvent.click(within(line).getByRole('button', { name: 'See the drifts' }))
    await waitFor(() => expect(screen.getByRole('tab', { name: /Drifts/ }).getAttribute('aria-selected')).toBe('true'))
  })

  it('says one guest in the singular', async () => {
    setPolicy(true)
    mock.routes['GET /drifts'] = () => reply(200, { drifts: [stray(1)], computed: true })
    renderTab()
    expect((await screen.findByTestId('ipfilter-banner-unzoned')).textContent).toContain('1 guest outside every zone shares the network of an enforced zone: it is not filtered.')
  })

  it('reads no drift for the banner while the filter is off or no zone is enforced', async () => {
    setPolicy(true, [zone('zw', { name: 'web' })])
    mock.routes['GET /drifts'] = () => reply(200, { drifts: [stray(1)], computed: true })
    renderTab()
    await ready()
    await waitFor(() => expect(calls('GET /status').length).toBeGreaterThan(0))
    expect(calls('GET /drifts')).toHaveLength(0)
    expect(screen.queryByTestId('ipfilter-banner-unzoned')).toBeNull()
  })

  it('counts only the clusters that computed their drifts', () => {
    expect(unzonedSameNetwork({
      a: { computed: true, drifts: [stray(1), stray(2)] },
      b: { computed: false, drifts: [stray(3)] },
      c: undefined,
    })).toBe(2)
    expect(unzonedSameNetwork({})).toBe(0)
  })
})
