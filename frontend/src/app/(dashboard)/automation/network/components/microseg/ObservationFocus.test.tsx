/**
 * The Observation sub-tab opened from a figure of the Dashboard: filtered on the type of flow of a tile, on the
 * service of a row, or on both, the service in a line the user can close.
 */

import { describe, expect, it } from 'vitest'

import { screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'
import type { MicrosegSuggestion } from '@/lib/microseg/types'

import { mock, policy, renderTab, reply, zone, BASE, fetchMock, REVISION_HEAD } from './microsegTestKit'
import MicrosegTab from './MicrosegTab'
import { installFreshMocks } from './policyTestKit'

installFreshMocks()

const web = zone('zw', { name: 'web' })
const db = zone('zd', { name: 'db' })

const sug = (id: string, over: Partial<MicrosegSuggestion> = {}): MicrosegSuggestion => ({
  id, policy_id: 'p1', connection_id: 'c1', kind: 'would_block', src_key: `k${id}`, src_ip: '', src_zone_id: 'zw', dst_ip: '10.0.0.9', dst_zone_id: 'zd',
  proto: 'tcp', dport: '22', hits: 12, first_seen: '2026-11-01T10:00:00Z', last_seen: '2026-11-02T12:00:00Z', status: 'pending', ...over,
})

const listCalls = () => fetchMock.mock.calls.map(([u]) => String(u).replace(BASE, '')).filter(u => u.startsWith('/suggestions?'))

function setup() {
  mock.routes['GET /policy'] = () => reply(200, policy({ zones: [web, db], last_revision: REVISION_HEAD }))
  mock.routes['GET /suggestions*'] = () => reply(200, { suggestions: [sug('s1')], limit: 26, offset: 0 })
}

describe('Observation opened from the Dashboard', () => {
  it('opens on the type of flow of a tile: the Type filter says it and the list asks for it', async () => {
    setup()
    renderTab(<MicrosegTab connectionId='c1' initialSubTab='observation' initialObservation={{ kind: 'blocked' }} />)

    expect((await screen.findByRole('combobox', { name: 'Type' })).textContent).toBe('TypeBlocked')
    await waitFor(() => expect(listCalls()).toContain('/suggestions?kind=blocked&limit=26&status=pending'))
    expect(screen.queryByTestId('observation-service-filter')).toBeNull()
  })

  it('opens on a service and its type: the list asks for the ports of the service, a line names it', async () => {
    setup()
    renderTab(<MicrosegTab connectionId='c1' initialSubTab='observation' initialObservation={{ kind: 'would_block', service: { label: 'SSH', tokens: ['tcp/22', 'udp/22'] } }} />)

    const banner = await screen.findByTestId('observation-service-filter')
    expect(banner.textContent).toContain('Filtered on the service SSH (tcp/22, udp/22)')
    await waitFor(() => expect(listCalls()).toContain('/suggestions?kind=would_block&limit=26&status=pending&service=tcp%2F22&service=udp%2F22'))
  })

  it('shows every service again once the line is closed, the other filters kept', async () => {
    setup()
    renderTab(<MicrosegTab connectionId='c1' initialSubTab='observation' initialObservation={{ kind: 'would_block', service: { label: 'SSH', tokens: ['tcp/22'] } }} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Show every service' }))
    await waitFor(() => expect(screen.queryByTestId('observation-service-filter')).toBeNull())
    await waitFor(() => expect(listCalls().at(-1)).toBe('/suggestions?kind=would_block&limit=26&status=pending'))
  })

  it('opens on a zone of the legend: the Zone filter says it and the list asks for it', async () => {
    setup()
    renderTab(<MicrosegTab connectionId='c1' initialSubTab='observation' initialObservation={{ zoneId: 'zd' }} />)

    expect((await screen.findByRole('combobox', { name: 'Zone' })).textContent).toBe('Zonedb')
    await waitFor(() => expect(listCalls()).toContain('/suggestions?limit=26&status=pending&zone=zd'))
  })

  it('opens on the flows whose source is in no zone, in a line the user can close', async () => {
    setup()
    renderTab(<MicrosegTab connectionId='c1' initialSubTab='observation' initialObservation={{ source: 'unknown' }} />)

    const banner = await screen.findByTestId('observation-source-filter')
    expect(banner.textContent).toContain('Filtered on the flows whose source is in no zone')
    await waitFor(() => expect(listCalls()).toContain('/suggestions?limit=26&status=pending&source=unknown'))
    fireEvent.click(screen.getByRole('button', { name: 'Show every source' }))
    await waitFor(() => expect(listCalls().at(-1)).toBe('/suggestions?limit=26&status=pending'))
    expect(screen.queryByTestId('observation-source-filter')).toBeNull()
  })

  it('forgets the Dashboard filter when another sub-tab is opened and the Observation one again', async () => {
    setup()
    renderTab(<MicrosegTab connectionId='c1' initialSubTab='observation' initialObservation={{ service: { label: 'SSH', tokens: ['tcp/22'] } }} />)

    await screen.findByTestId('observation-service-filter')
    fireEvent.click(screen.getByRole('tab', { name: /History/ }))
    fireEvent.click(await screen.findByRole('tab', { name: /Observation/ }))
    await waitFor(() => expect(listCalls().at(-1)).toBe('/suggestions?limit=26&status=pending'))
    expect(screen.queryByTestId('observation-service-filter')).toBeNull()
  })
})
