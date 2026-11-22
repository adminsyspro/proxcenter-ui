/**
 * The line of the confirmation that enforces the first zone of a policy whose IP filter is on: members ready, members
 * needing attention, or nothing computed yet, with the way to the addresses per member. Nothing otherwise.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { fireEvent, screen, waitFor } from '@/__tests__/setup/renderWithProviders'
import type { MicrosegZone } from '@/lib/microseg/types'

import IPFilterEnforceLine from './IPFilterEnforceLine'
import { filterAnswer, filterGuest } from './ipFilterTestKit'
import { calls, mock, policy, renderTab, reply, resetMocks, zone } from './microsegTestKit'

beforeEach(resetMocks)
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function setPolicy(ipFilter: boolean | undefined, zones: MicrosegZone[]) {
  const base = policy({ zones })
  mock.routes['GET /policy'] = () => reply(200, { ...base, policy: ipFilter === undefined ? base.policy : { ...base.policy, ip_filter: ipFilter, guest_filters: null } })
}

const line = () => screen.queryByTestId('ipfilter-enforce-line')
const settled = async () => {
  await waitFor(() => expect(calls('GET /policy').length).toBeGreaterThan(0))
  // The policy answered and the line had a render to show itself.
  await new Promise(resolve => setTimeout(resolve, 20))
}

describe('the first zone enforced with the IP filter on', () => {
  it('counts the members ready and those needing attention, and opens the addresses per member', async () => {
    setPolicy(true, [zone('zw', { name: 'web' }), zone('zd', { name: 'db', state: 'disabled' })])
    mock.routes['GET /ipfilter'] = () => reply(200, filterAnswer([
      filterGuest(), filterGuest({ vmid: 101, name: 'web-2', applied: false }),
      filterGuest({ vmid: 102, name: 'web-3', mode: 'no_address', applied: false, nics: {}, no_address: ['net0'] }),
      filterGuest({ vmid: 103, name: 'web-4', mode: 'excluded', applied: false, nics: {} }),
    ]))
    renderTab(<IPFilterEnforceLine connectionId='c1' />)
    await waitFor(() => expect(line()?.textContent).toBe('IP filter: 2 members ready, 1 needs attentionDetails'))
    fireEvent.click(screen.getByRole('button', { name: 'Details' }))
    expect(await screen.findByRole('dialog', { name: 'IP filter: addresses per member' })).toBeTruthy()
    expect(await screen.findByRole('listitem', { name: 'web-3' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('says when every member is ready', async () => {
    setPolicy(true, [zone('zw', { name: 'web' })])
    mock.routes['GET /ipfilter'] = () => reply(200, filterAnswer([filterGuest()]))
    renderTab(<IPFilterEnforceLine connectionId='c1' />)
    await waitFor(() => expect(line()?.textContent).toBe('IP filter: 1 member ready, none needs attentionDetails'))
  })

  it('asks for a check while nothing is computed, with no details to open', async () => {
    setPolicy(true, [zone('zw', { name: 'web' })])
    mock.routes['GET /ipfilter'] = () => reply(200, filterAnswer([], { computed: false }))
    renderTab(<IPFilterEnforceLine connectionId='c1' />)
    await waitFor(() => expect(line()?.textContent).toBe('IP filter: not computed yet, run a checkDetails'))
    expect((screen.getByRole('button', { name: 'Details' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('no line', () => {
  it.each([
    ['a zone is enforced already', true, [zone('zw', { name: 'web', state: 'enforce' }), zone('zd', { name: 'db' })]],
    ['the IP filter is off', false, [zone('zw', { name: 'web' })]],
    ['the orchestrator does not know the IP filter', undefined, [zone('zw', { name: 'web' })]],
  ] as Array<[string, boolean | undefined, MicrosegZone[]]>)('when %s, and nothing is read for it', async (_name, ipFilter, zones) => {
    setPolicy(ipFilter, zones)
    mock.routes['GET /ipfilter'] = () => reply(200, filterAnswer())
    renderTab(<IPFilterEnforceLine connectionId='c1' />)
    await settled()
    expect(line()).toBeNull()
    expect(calls('GET /ipfilter')).toHaveLength(0)
  })
})
