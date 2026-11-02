/**
 * Observation sub-tab: the flows seen by the engine as suggestions, filtered and
 * paged by the server, accepted (as a zone flow or as a CIDR) or dismissed one
 * by one or in bulk.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { within } from '@testing-library/react'

import { screen, fireEvent, renderWithProviders, waitFor } from '@/__tests__/setup/renderWithProviders'
import type { MicrosegSuggestion } from '@/lib/microseg/types'

import { calls, mock, policy, renderTab, reply, zone, BASE, fetchMock, REVISION_HEAD } from './microsegTestKit'
import ObservationPanel from './ObservationPanel'
import { body, installFreshMocks } from './policyTestKit'

installFreshMocks()

// Dates are formatted in the zone of the process: pin it so the expected strings do not depend on the machine.
const originalTZ = process.env.TZ
beforeAll(() => { process.env.TZ = 'UTC' })
afterAll(() => {
  if (originalTZ === undefined) delete process.env.TZ
  else process.env.TZ = originalTZ
})

const web = zone('zw', { name: 'web' })
const db = zone('zd', { name: 'db' })

const sug = (id: string, over: Partial<MicrosegSuggestion> = {}): MicrosegSuggestion => ({
  id, policy_id: 'p1', kind: 'would_block', src_key: `k${id}`, src_ip: '', src_zone_id: 'zw', dst_ip: '10.0.0.9', dst_zone_id: 'zd',
  proto: 'tcp', dport: '443', hits: 12, first_seen: '2026-11-01T10:00:00Z', last_seen: '2026-11-02T12:00:00Z', status: 'pending', ...over,
})

const ROUTE = 'GET /suggestions?limit=26&status=pending'
const listCalls = () => fetchMock.mock.calls.map(([u]) => String(u).replace(BASE, '')).filter(u => u.startsWith('/suggestions?'))

function setup(suggestions: MicrosegSuggestion[], opts: { route?: string; pending?: boolean } = {}) {
  window.localStorage.setItem('microseg.subTab', 'observation')
  mock.routes['GET /policy'] = () => reply(200, policy({ zones: [web, db], last_revision: REVISION_HEAD }))
  mock.routes[opts.route ?? ROUTE] = () => reply(200, { suggestions, limit: 26, offset: 0 })
  mock.routes['POST /suggestions/resolve'] = () => reply(200, { version: 4 })
  return renderTab()
}

const row = (name: RegExp | string) => screen.findByRole('listitem', { name })
const unknownSource = sug('u1', { src_zone_id: '', src_ip: '192.168.1.50' })

describe('observation list', () => {
  it('shows one line per flow: source, destination, protocol and port, hits, last seen', async () => {
    setup([sug('s1'), unknownSource])
    const line = await row('web to db')
    expect(within(line).getByText('web')).toBeTruthy()
    expect(within(line).getByText('db')).toBeTruthy()
    expect(within(line).getByText('tcp/443')).toBeTruthy()
    expect(within(line).getByText('12 hits')).toBeTruthy()
    expect(within(line).getByText(/Last seen Nov 2, 2026, 12:00\sPM/)).toBeTruthy()
    expect(line.querySelector('i.ri-eye-line')).toBeTruthy()
  })

  it('shows a blocked flow with its own glyph', async () => {
    setup([sug('b1', { kind: 'blocked' })])
    expect((await row('web to db')).querySelector('i.ri-forbid-line')).toBeTruthy()
  })

  it('shows an unknown source as an IP with the accept as CIDR action, and Accept disabled', async () => {
    setup([unknownSource])
    const line = await row('192.168.1.50 to db')
    expect(within(line).getByText('192.168.1.50')).toBeTruthy()
    const accept = within(line).getByRole('button', { name: 'Accept' }) as HTMLButtonElement
    expect(accept.disabled).toBe(true)
    const cidr = within(line).getByRole('button', { name: 'Accept as CIDR' }) as HTMLButtonElement
    expect(cidr.disabled).toBe(false)

    fireEvent.click(cidr)
    await waitFor(() => expect(calls('POST /suggestions/resolve')).toHaveLength(1))
    expect(body(calls('POST /suggestions/resolve')[0][1])).toEqual({ version: 3, ids: ['u1'], action: 'accept_cidr' })
  })

  it('disables the accept as CIDR when the source has no IP', async () => {
    setup([sug('s1')])
    const line = await row('web to db')
    expect((within(line).getByRole('button', { name: 'Accept as CIDR' }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(line).getByRole('button', { name: 'Accept' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('keeps the addresses and times under the chevron', async () => {
    setup([unknownSource])
    const line = await row('192.168.1.50 to db')
    expect(within(line).queryByText(/First seen/)).toBeNull()
    fireEvent.click(within(line).getByRole('button', { name: 'Show details' }))
    expect(within(line).getByText(/First seen Nov 1, 2026, 10:00\sAM/)).toBeTruthy()
    expect(within(line).getByText('Source: 192.168.1.50')).toBeTruthy()
    expect(within(line).getByText('Destination: db (10.0.0.9)')).toBeTruthy()
  })

  it('says there is nothing to show', async () => {
    setup([])
    expect(await screen.findByText('No observed flow matches these filters.')).toBeTruthy()
  })

  it('shows the sampling notice with a link that opens the settings of the tab', async () => {
    setup([])
    expect(await screen.findByText(/at most one line per second per chain by default/)).toBeTruthy()
    const link = screen.getByRole('button', { name: 'Open settings' }) as HTMLButtonElement
    expect(link.disabled).toBe(false)
    fireEvent.click(link)
    expect(await screen.findByRole('dialog', { name: 'Micro-segmentation settings' })).toBeTruthy()
  })
})

describe('unit actions', () => {
  it('accepts a flow of a zone and reloads the list and the draft', async () => {
    setup([sug('s1')])
    const line = await row('web to db')
    const before = calls('GET /policy').length
    fireEvent.click(within(line).getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(calls('POST /suggestions/resolve')).toHaveLength(1))
    expect(body(calls('POST /suggestions/resolve')[0][1])).toEqual({ version: 3, ids: ['s1'], action: 'accept' })
    await waitFor(() => expect(calls('GET /policy').length).toBeGreaterThan(before))
    await waitFor(() => expect(listCalls().length).toBeGreaterThan(1))
    expect(await screen.findByText('1 flow accepted into the draft')).toBeTruthy()
  })

  it('dismisses a flow', async () => {
    setup([sug('s1')])
    fireEvent.click(within(await row('web to db')).getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(calls('POST /suggestions/resolve')).toHaveLength(1))
    expect(body(calls('POST /suggestions/resolve')[0][1])).toEqual({ version: 3, ids: ['s1'], action: 'dismiss' })
  })

  it('shows the server message of a 400 INVALID', async () => {
    setup([sug('s1')])
    mock.routes['POST /suggestions/resolve'] = () => reply(400, { code: 'INVALID', error: 'suggestion s1 has no source zone' })
    fireEvent.click(within(await row('web to db')).getByRole('button', { name: 'Accept' }))
    expect(await screen.findByText(/suggestion s1 has no source zone/)).toBeTruthy()
  })

  it('reloads on a 409 and keeps the selection', async () => {
    setup([sug('s1'), sug('s2', { src_zone_id: 'zd', dst_zone_id: 'zw' })])
    mock.routes['POST /suggestions/resolve'] = () => reply(409, { code: 'VERSION_CONFLICT', error: 'x' })
    await screen.findByRole('listitem', { name: 'web to db' })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all on this page' }))
    expect(screen.getByText('2 selected')).toBeTruthy()
    const before = calls('GET /policy').length
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss selected' }))
    expect(await screen.findByText(/changed elsewhere and was reloaded/)).toBeTruthy()
    await waitFor(() => expect(calls('GET /policy').length).toBeGreaterThan(before))
    expect(screen.getByText('2 selected')).toBeTruthy()
  })
})

describe('bulk actions', () => {
  const three = [sug('s1'), sug('s2', { dst_ip: '10.0.0.8' }), sug('s3', { dst_ip: '10.0.0.7' })]

  it('accepts three suggestions at once and reloads', async () => {
    setup(three)
    await screen.findAllByRole('listitem')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all on this page' }))
    expect(screen.getByText('3 selected')).toBeTruthy()
    const before = listCalls().length
    fireEvent.click(screen.getByRole('button', { name: 'Accept selected' }))
    await waitFor(() => expect(calls('POST /suggestions/resolve')).toHaveLength(1))
    expect(body(calls('POST /suggestions/resolve')[0][1])).toEqual({ version: 3, ids: ['s1', 's2', 's3'], action: 'accept' })
    await waitFor(() => expect(listCalls().length).toBeGreaterThan(before))
    await waitFor(() => expect(screen.queryByText('3 selected')).toBeNull())
  })

  it('has a three-state select-all over the current page', async () => {
    setup(three)
    await screen.findAllByRole('listitem')
    const all = screen.getByRole('checkbox', { name: 'Select all on this page' }) as HTMLInputElement
    const indeterminate = () => all.getAttribute('data-indeterminate') === 'true'
    expect(all.checked).toBe(false)
    expect(indeterminate()).toBe(false)

    const lines = screen.getAllByRole('listitem')
    fireEvent.click(within(lines[0]).getByRole('checkbox'))
    expect(all.checked).toBe(false)
    expect(indeterminate()).toBe(true)

    fireEvent.click(all)
    expect(all.checked).toBe(true)
    expect(indeterminate()).toBe(false)

    fireEvent.click(all)
    expect(all.checked).toBe(false)
    expect(screen.queryByText(/ selected$/)).toBeNull()
  })

  it('disables the bulk Accept while a selected flow has no source zone, and offers the CIDR', async () => {
    setup([sug('s1'), unknownSource])
    await screen.findAllByRole('listitem')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all on this page' }))
    expect((screen.getByRole('button', { name: 'Accept selected' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Accept selected as CIDR' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Dismiss selected' }) as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(within(screen.getByRole('listitem', { name: 'web to db' })).getByRole('checkbox'))
    expect((screen.getByRole('button', { name: 'Accept selected as CIDR' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Accept selected as CIDR' }))
    await waitFor(() => expect(calls('POST /suggestions/resolve')).toHaveLength(1))
    expect(body(calls('POST /suggestions/resolve')[0][1])).toEqual({ version: 3, ids: ['u1'], action: 'accept_cidr' })
  })

  it('has no bulk bar until something is selected', async () => {
    setup(three)
    await screen.findAllByRole('listitem')
    expect(screen.queryByRole('button', { name: 'Accept selected' })).toBeNull()
  })
})

describe('server side filters and pagination', () => {
  it('asks the server for pending flows by default, 25 per page (one more to know there is a next page)', async () => {
    setup([sug('s1')])
    await row('web to db')
    expect(listCalls()).toContain('/suggestions?limit=26&status=pending')
  })

  it('filters by type, status and zone on the server and goes back to the first page', async () => {
    setup([sug('s1')])
    mock.routes['GET /suggestions?kind=blocked&limit=26&status=pending'] = () => reply(200, { suggestions: [sug('b1', { kind: 'blocked' })], limit: 26, offset: 0 })
    mock.routes['GET /suggestions?kind=blocked&limit=26&status=dismissed'] = () => reply(200, { suggestions: [], limit: 26, offset: 0 })
    mock.routes['GET /suggestions?kind=blocked&limit=26&status=dismissed&zone=zd'] = () => reply(200, { suggestions: [], limit: 26, offset: 0 })
    await row('web to db')

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Type' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Blocked' }))
    await waitFor(() => expect(listCalls()).toContain('/suggestions?kind=blocked&limit=26&status=pending'))

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Status' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Dismissed' }))
    await waitFor(() => expect(listCalls()).toContain('/suggestions?kind=blocked&limit=26&status=dismissed'))

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Zone' }))
    fireEvent.click(await screen.findByRole('option', { name: 'db' }))
    await waitFor(() => expect(listCalls()).toContain('/suggestions?kind=blocked&limit=26&status=dismissed&zone=zd'))
  })

  it('pages with limit and offset, and stops at the last page', async () => {
    const page = (from: number, n: number) => Array.from({ length: n }, (_, i) => sug(`p${from + i}`, { dst_ip: `10.1.0.${from + i}` }))
    setup(page(0, 26))
    mock.routes['GET /suggestions?limit=26&offset=25&status=pending'] = () => reply(200, { suggestions: page(25, 3), limit: 26, offset: 25 })
    await screen.findAllByRole('listitem')
    expect(screen.getAllByRole('listitem')).toHaveLength(25)
    expect(screen.getByText('Page 1')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Previous page' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(screen.getByText('Page 2')).toBeTruthy())
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(3))
    expect(listCalls()).toContain('/suggestions?limit=26&offset=25&status=pending')
    expect((screen.getByRole('button', { name: 'Next page' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }))
    await waitFor(() => expect(screen.getByText('Page 1')).toBeTruthy())
  })

  it('goes back one page when the last page has nothing left to show', async () => {
    const full = Array.from({ length: 26 }, (_, i) => sug(`p${i}`, { dst_ip: `10.1.0.${i}` }))
    setup(full)
    let resolved = false
    mock.routes['GET /suggestions?limit=26&offset=25&status=pending'] = () => reply(200, { suggestions: resolved ? [] : [sug('p25')], limit: 26, offset: 25 })
    mock.routes['POST /suggestions/resolve'] = () => { resolved = true; return reply(200, { version: 4 }) }
    await screen.findAllByRole('listitem')
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(screen.getByText('Page 2')).toBeTruthy())
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1))

    fireEvent.click(within(screen.getAllByRole('listitem')[0]).getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(screen.getByText('Page 1')).toBeTruthy())
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(25))
    expect(screen.queryByText('No observed flow matches these filters.')).toBeNull()
  })

  it('stays on the page when the rows resolved are not the last of it', async () => {
    const full = Array.from({ length: 26 }, (_, i) => sug(`p${i}`, { dst_ip: `10.1.0.${i}` }))
    setup(full)
    mock.routes['GET /suggestions?limit=26&offset=25&status=pending'] = () => reply(200, { suggestions: [sug('p25'), sug('p26', { dst_ip: '10.1.0.99' })], limit: 26, offset: 25 })
    await screen.findAllByRole('listitem')
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2))
    fireEvent.click(within(screen.getAllByRole('listitem')[0]).getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(calls('POST /suggestions/resolve')).toHaveLength(1))
    await waitFor(() => expect(screen.getByText('1 flow dismissed')).toBeTruthy())
    expect(screen.getByText('Page 2')).toBeTruthy()
  })

  it('drops the selection when the page changes', async () => {
    const full = Array.from({ length: 26 }, (_, i) => sug(`p${i}`, { dst_ip: `10.1.0.${i}` }))
    setup(full)
    mock.routes['GET /suggestions?limit=26&offset=25&status=pending'] = () => reply(200, { suggestions: [sug('p25')], limit: 26, offset: 25 })
    await screen.findAllByRole('listitem')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all on this page' }))
    expect(screen.getByText('25 selected')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(screen.getByText('Page 2')).toBeTruthy())
    expect(screen.queryByText('25 selected')).toBeNull()
  })

  it('shows the error of a failed read with a retry', async () => {
    setup([])
    mock.routes[ROUTE] = () => reply(503, { code: 'NOT_LEADER', error: 'x' })
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy()
  })
})

describe('settings link', () => {
  it('is wired through the onOpenSettings prop of the panel', async () => {
    const onOpenSettings = vi.fn()
    mock.routes[ROUTE] = () => reply(200, { suggestions: [], limit: 26, offset: 0 })
    renderWithProviders(
      <ObservationPanel
        connectionId='c1'
        policy={policy({ zones: [web, db] })}
        reloadPolicy={async () => undefined}
        goToSubTab={() => undefined}
        onOpenPlan={() => undefined}
        startRun={() => undefined}
        onOpenSettings={onOpenSettings}
      />,
    )
    const link = await screen.findByRole('button', { name: 'Open settings' })
    expect((link as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(link)
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
  })

  it('is disabled while the panel has no way to open the settings', async () => {
    mock.routes[ROUTE] = () => reply(200, { suggestions: [], limit: 26, offset: 0 })
    renderWithProviders(
      <ObservationPanel
        connectionId='c1'
        policy={policy({ zones: [web, db] })}
        reloadPolicy={async () => undefined}
        goToSubTab={() => undefined}
        onOpenPlan={() => undefined}
        startRun={() => undefined}
      />,
    )
    expect(((await screen.findByRole('button', { name: 'Open settings' })) as HTMLButtonElement).disabled).toBe(true)
  })
})
