/**
 * "IP filter: addresses per member": the members GET /ipfilter lists, 25 per page, one line each (glyph and status,
 * name, VMID and node, zone, state, how many addresses), the lists behind a chevron, and a box that keeps only the
 * members needing attention.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, within } from '@testing-library/react'

import { fireEvent, screen, waitFor } from '@/__tests__/setup/renderWithProviders'

import IPFilterDetailsDialog, { IP_FILTER_PAGE_SIZE } from './IPFilterDetailsDialog'
import { filterAnswer, filterGuest } from './ipFilterTestKit'
import { BASE, GUESTS_ROUTE, calls, fetchMock, mock, renderTab, reply, resetMocks } from './microsegTestKit'
import { vm } from './policyTestKit'

beforeEach(resetMocks)
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** 60 members: every tenth has no known address, every seventh an address held back. */
const MANY = Array.from({ length: 60 }, (_, i) => filterGuest({
  vmid: 100 + i, name: `guest-${String(i).padStart(2, '0')}`, zone: i % 2 ? 'db' : 'web',
  ...(i % 10 === 3 ? { mode: 'no_address', applied: false, nics: {}, no_address: ['net0'] } : {}),
  ...(i % 7 === 0 ? { held: [{ nic: 'net0', addr: '10.0.9.9', reason: 'guest', by: 'other-1' }] } : {}),
}))
const ATTENTION = MANY.filter(g => g.mode === 'no_address' || (g.held ?? []).length > 0).length

const rows = () => within(screen.getByRole('list', { name: 'IP filter: addresses per member' })).getAllByRole('listitem').filter(r => r.hasAttribute('data-guest'))
const open = (props: Partial<Parameters<typeof IPFilterDetailsDialog>[0]> = {}) => {
  const onClose = vi.fn()
  renderTab(<IPFilterDetailsDialog connectionId='c1' onClose={onClose} {...props} />)
  return onClose
}

describe('the list', () => {
  it('shows 25 members per page and goes to the next ones', async () => {
    mock.routes['GET /ipfilter'] = () => reply(200, filterAnswer(MANY))
    open()
    await screen.findByRole('listitem', { name: 'guest-00' })
    expect(IP_FILTER_PAGE_SIZE).toBe(25)
    expect(rows()).toHaveLength(25)
    expect(screen.getByText('60 members')).toBeTruthy()
    expect(screen.getByText('1-25 of 60')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(rows()).toHaveLength(25)
    expect(rows()[0].getAttribute('aria-label')).toBe('guest-25')
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(rows().map(r => r.getAttribute('aria-label'))).toEqual(Array.from({ length: 10 }, (_, i) => `guest-${50 + i}`))
  })

  it('puts on one line the glyph with the status of the inventory, the name, where it runs, its zone, its state and its addresses', async () => {
    mock.routes['GET /ipfilter'] = () => reply(200, filterAnswer([
      filterGuest({ nics: { net0: ['0.0.0.0', '10.0.0.5', 'fe80::1'], net1: ['10.0.1.5'] } }),
      filterGuest({ type: 'lxc', vmid: 200, name: 'ct-1', zone: 'db', mode: 'excluded', applied: false, nics: {} }),
    ]))
    mock.routes[`GET ${GUESTS_ROUTE}`] = () => reply(200, { data: { vms: [vm(100, 'web-1', ['zone-web']), vm(200, 'ct-1', ['zone-db'], { type: 'lxc', status: 'stopped' })] } })
    open()
    const web = await screen.findByRole('listitem', { name: 'web-1' })
    expect(web.textContent).toBe('web-1100 · pve1webFiltered2 addresses')
    expect(web.querySelector('i.ri-computer-fill, i[class*="ri-"]')).toBeTruthy()
    const ct = screen.getByRole('listitem', { name: 'ct-1' })
    expect(ct.textContent).toBe('ct-1200 · pve1dbLeft out0 addresses')
    expect(within(ct).getByTestId('ipfilter-state-chip').textContent).toBe('Left out')
  })

  it('opens the lists of a member behind its chevron, and folds them again', async () => {
    mock.routes['GET /ipfilter'] = () => reply(200, filterAnswer([filterGuest({ dhcp: ['net0'], held: [{ nic: 'net0', addr: '10.0.0.7', reason: 'guest', by: 'db-1' }] })]))
    open()
    const line = await screen.findByRole('listitem', { name: 'web-1' })
    expect(within(line).queryByTestId('ipfilter-nic')).toBeNull()
    fireEvent.click(within(line).getByRole('button', { name: 'Show the addresses of web-1' }))
    expect(within(line).getByRole('listitem', { name: 'net0' }).textContent).toBe('net010.0.0.50.0.0.0, fe80::be24:11ff:fe00:64')
    expect(within(line).getByTestId('ipfilter-held').textContent).toBe('10.0.0.7 on net0: held by db-1, a member of another zone')
    expect(within(line).getByTestId('ipfilter-dhcp')).toBeTruthy()
    // Read only: the address held back is not allowed from here.
    expect(within(line).queryByRole('button', { name: 'Allow 10.0.0.7' })).toBeNull()
    fireEvent.click(within(line).getByRole('button', { name: 'Hide the addresses of web-1' }))
    await waitFor(() => expect(within(line).queryByTestId('ipfilter-nic')).toBeNull())
  })
})

describe('only those needing attention', () => {
  it('keeps the members without an address or with an address held, and goes back to the first page', async () => {
    mock.routes['GET /ipfilter'] = () => reply(200, filterAnswer(MANY))
    open()
    await screen.findByRole('listitem', { name: 'guest-00' })
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Only those needing attention' }))
    expect(rows()).toHaveLength(ATTENTION)
    expect(screen.getByText(`${ATTENTION} members`)).toBeTruthy()
    expect(rows().every(r => /No address|Filtered/.test(r.textContent ?? ''))).toBe(true)
    expect(rows()[0].getAttribute('aria-label')).toBe('guest-00')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Only those needing attention' }))
    expect(rows()).toHaveLength(25)
  })

  it('says so when no member needs attention', async () => {
    mock.routes['GET /ipfilter'] = () => reply(200, filterAnswer([filterGuest()]))
    open()
    await screen.findByRole('listitem', { name: 'web-1' })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Only those needing attention' }))
    expect(screen.getByText('No member needs attention')).toBeTruthy()
    expect(screen.queryByRole('listitem', { name: 'web-1' })).toBeNull()
  })
})

describe('what cannot be listed', () => {
  it('waits for the first full check instead of an empty list', async () => {
    mock.routes['GET /ipfilter'] = () => reply(200, filterAnswer([filterGuest()], { computed: false }))
    open()
    expect(await screen.findByText('Waiting for the first full check')).toBeTruthy()
    expect(screen.queryByRole('listitem', { name: 'web-1' })).toBeNull()
  })

  it('says a failed read with a retry, and an empty answer as no member', async () => {
    mock.routes['GET /ipfilter'] = () => reply(502, { code: 'ORCHESTRATOR_ERROR', error: 'down' })
    const onClose = open()
    expect(await screen.findByRole('alert')).toBeTruthy()
    mock.routes['GET /ipfilter'] = () => reply(200, filterAnswer([]))
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('No member of a zone')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('lists the members of every cluster given, each with the chip of its cluster, never the ID of one outside the scope', async () => {
    mock.routes['GET /ipfilter'] = () => reply(200, filterAnswer([filterGuest()]))
    // The second cluster answers through its own relay base.
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === BASE.replace('/c1', '/c2') + '/ipfilter') return reply(200, filterAnswer([filterGuest({ name: 'web-9', vmid: 100 })]))
      const handler = mock.routes[`${init?.method ?? 'GET'} ${url.replace(BASE, '')}`]
      return handler ? handler(init) : reply(404, { code: 'NOT_FOUND', error: 'no mock' })
    })
    open({ clusterIds: ['c1', 'c2'], clusterName: id => (id === 'c1' ? 'Paris' : id) })
    const own = await screen.findByRole('listitem', { name: 'web-1' })
    const peer = await screen.findByRole('listitem', { name: 'web-9' })
    expect(own.textContent).toContain('Paris')
    expect(peer.textContent).toContain('Another cluster')
    expect(peer.textContent).not.toContain('c2')
    expect(calls('GET /ipfilter')).toHaveLength(1)
  })
})
