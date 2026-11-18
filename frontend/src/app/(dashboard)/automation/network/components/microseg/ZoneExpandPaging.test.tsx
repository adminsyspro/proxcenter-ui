/**
 * The zone dialog follows its content up to the page height and pages every list of it from the rows that fit (ten without a measure).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { within } from '@testing-library/react'

import { screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'

import { fetchMock, mock, reply } from './microsegTestKit'
import { installFreshMocks } from './policyTestKit'
import { flowOf, node, setup, wouldBlock } from './zoneMapTestKit'

installFreshMocks()

const ids = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => `${prefix}${i}`)
let seq = 5000
const event = () => ({
  seq: seq--, ts: new Date(Date.now() - 60_000).toISOString(), node: 'pve1', vmid: 101, type: 'qemu', guest: 'db1', zone: 'db', src_zone: 'web',
  src_ip: '10.0.0.5', dst_ip: '10.0.0.2', proto: 'tcp', dport: 5432, verdict: 'would_block',
})

async function openDialog(opts: Parameters<typeof setup>[0]) {
  setup(opts)
  fireEvent.click(await node('zone:zd'))
  const panel = await screen.findByRole('complementary', { name: 'Zone db' })
  fireEvent.click(within(panel).getByRole('button', { name: 'Expand' }))
  return screen.findByRole('dialog', { name: 'Zone details · db' })
}

const setViewport = (h: number) => { Object.defineProperty(window, 'innerHeight', { value: h, configurable: true, writable: true }) }
const pageSizes: Record<number, number> = {}
const realHeight = window.innerHeight

describe('zone dialog: page height and paging', () => {
  beforeEach(() => setViewport(400))
  afterEach(() => setViewport(realHeight))

  it('follows its content up to the page height', async () => {
    const dialog = await openDialog({})
    const rules = Array.from(document.querySelectorAll('style')).map(s => s.textContent).join('')
    expect(dialog.className).toContain('MuiDialog-paper')
    expect(rules).toContain('max-height:calc(100vh - 32px)')
    expect(rules).toContain('min-height:50vh')
    expect(rules).not.toMatch(/(^|[;{])height:calc\(100vh/)
  })

  it.each([900, 1200])('shows a page of logs sized from a %i px viewport', async h => {
    setViewport(h)
    mock.routes['GET /events?limit=200&zone='] = () => reply(200, { events: [], truncated: false, oldest: null })
    mock.routes['GET /events?limit=200'] = () => reply(200, { events: Array.from({ length: 60 }, event), truncated: false, oldest: null })
    const dialog = await openDialog({})
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Logs' }))
    await waitFor(() => expect(within(dialog).getAllByRole('row').length).toBeGreaterThan(1))
    pageSizes[h] = within(dialog).getAllByRole('row').length - 1
  })

  it('derives the rows per page from the viewport height', () => {
    expect(pageSizes[900]).toBeGreaterThan(10)
    expect(pageSizes[1200]).toBeGreaterThan(pageSizes[900])
  })

  it('renders a short list without a filler: the list has no fixed height', async () => {
    mock.routes['GET /events?limit=200&zone='] = () => reply(200, { events: [], truncated: false, oldest: null })
    mock.routes['GET /events?limit=200'] = () => reply(200, { events: Array.from({ length: 3 }, event), truncated: false, oldest: null })
    const dialog = await openDialog({})
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Logs' }))
    await waitFor(() => expect(within(dialog).getAllByRole('row')).toHaveLength(4))
    const table = within(dialog).getByRole('table')
    expect(within(dialog).queryByTestId('logs-pager')).toBeNull()
    expect(table.parentElement?.getAttribute('style') ?? '').not.toMatch(/height/)
    expect(table.closest('[role=dialog]')?.querySelector('.MuiDialogContent-root')?.getAttribute('style') ?? '').not.toMatch(/height/)
  })

  it('pages the pending suggestions', async () => {
    const dialog = await openDialog({ suggestions: ids(12, 's').map(id => wouldBlock(id)) })
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Data' }))
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(10)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next page' }))
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(2)
  })

  it('pages the members', async () => {
    const dialog = await openDialog({ pending_members: Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, policy_id: 'p1', connection_id: 'c1', node: 'pve1', type: 'qemu', vmid: 100 + i, zone_id: 'zd' })) })
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Data' }))
    fireEvent.click(within(dialog).getByRole('tab', { name: /^Members/ }))
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(10)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next page' }))
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(2)
  })

  it('pages the incoming and the outgoing flows', async () => {
    const dialog = await openDialog({
      flows: [...ids(12, 'i').map(id => flowOf(id, { src_zone_id: 'zw', dst_zone_id: 'zd' })), ...ids(11, 'o').map(id => flowOf(id, { src_zone_id: 'zd', dst_zone_id: 'zw' }))],
    })
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Data' }))
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Incoming flows (12)' }))
    expect(within(dialog).getByRole('button', { name: 'Next page' })).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Outgoing flows (11)' }))
    expect(within(dialog).getByRole('button', { name: 'Next page' })).toBeTruthy()
  })

  it('pages the logs and loads older events at the last page', async () => {
    mock.routes['GET /events?limit=200&zone='] = () => reply(200, { events: [], truncated: false, oldest: null })
    mock.routes['GET /events?limit=200'] = () => reply(200, { events: Array.from({ length: 12 }, event), truncated: true, oldest: null })
    mock.routes['GET /events?limit=200&before_seq=*'] = () => reply(200, { events: Array.from({ length: 12 }, event), truncated: false, oldest: null })
    const dialog = await openDialog({})
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Logs' }))
    await waitFor(() => expect(within(dialog).getAllByRole('row')).toHaveLength(11))
    const pager = within(dialog).getByTestId('logs-pager')
    const next = within(pager).getByRole('button', { name: 'Next page' })
    fireEvent.click(next)
    await waitFor(() => expect(within(dialog).getAllByRole('row')).toHaveLength(3))
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes('before_seq'))).toHaveLength(0)
    fireEvent.click(next)
    await waitFor(() => expect(within(pager).getByText('Page 3')).toBeTruthy())
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes('before_seq'))).toHaveLength(1)
    expect(within(dialog).getAllByRole('row')).toHaveLength(5)
  })
})
