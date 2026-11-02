/**
 * Overview sub-tab: the map of the zones and their flows. The canvas of
 * @xyflow/react is replaced (see microsegTestKit) by a stand-in that renders the
 * real nodes and edges: jsdom measures nothing, so the real one draws no edge.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { within } from '@testing-library/react'

import { screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'
import type { MicrosegFlow, MicrosegSuggestion, MicrosegZone, PendingMember } from '@/lib/microseg/types'

import { calls, fetchMock, flow, mock, policy, renderTab, reply, GUESTS_ROUTE, REVISION_HEAD } from './microsegTestKit'
import { db, installFreshMocks, suggestion, vm, web } from './policyTestKit'

installFreshMocks()

const SUGGESTIONS = 'GET /suggestions?kind=would_block&status=pending&limit=200'
const originalMatchMedia = window.matchMedia
afterEach(() => { window.matchMedia = originalMatchMedia })

const flowOf = (id: string, over: Partial<MicrosegFlow> = {}): MicrosegFlow => ({ ...flow(id), src_zone_id: 'zw', dst_zone_id: 'zd', ...over })
const wouldBlock = (id: string, over: Partial<MicrosegSuggestion> = {}): MicrosegSuggestion => ({
  ...suggestion('2026-11-02T10:00:00Z'), id, src_zone_id: 'zw', dst_zone_id: 'zd', ...over,
})

function setup(opts: {
  zones?: MicrosegZone[]
  flows?: MicrosegFlow[]
  suggestions?: MicrosegSuggestion[] | 'error'
  vms?: unknown[]
  pending_members?: PendingMember[]
  pending_changes?: boolean
} = {}) {
  window.localStorage.setItem('microseg.subTab', 'overview')
  mock.routes['GET /policy'] = () => reply(200, policy({
    zones: opts.zones ?? [web(), db()], flows: opts.flows ?? [], pending_members: opts.pending_members ?? [],
    pending_changes: opts.pending_changes ?? false, last_revision: REVISION_HEAD,
  }))
  mock.routes[`GET ${GUESTS_ROUTE}`] = () => reply(200, { data: { vms: opts.vms ?? [] } })
  mock.routes[SUGGESTIONS] = () => (opts.suggestions === 'error'
    ? reply(500, { code: 'ORCHESTRATOR_ERROR', error: 'boom' })
    : reply(200, { suggestions: opts.suggestions ?? [], limit: 200, offset: 0 }))
  return renderTab()
}

const node = (id: string) => screen.findByTestId(`node-${id}`)
const pathOf = (id: string) => screen.findByTestId(`path-${id}`)
const reduceMotion = () => {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('prefers-reduced-motion'), media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

describe('zone nodes', () => {
  it('draws one node per zone on one line, with its name and its member count', async () => {
    setup({ vms: [vm(100, 'web-1', ['zone-web']), vm(101, 'web-2', ['zone-web'], { status: 'stopped' }), vm(200, 'db-1', ['zone-db']), vm(300, 'other', [])] })
    const w = await node('zone:zw')
    expect(within(w).getByText('web')).toBeTruthy()
    await waitFor(() => expect(within(w).getByText('2 members')).toBeTruthy())
    expect(within(await node('zone:zd')).getByText('1 member')).toBeTruthy()
    expect(within(w).queryByText(/net0|vmbr/)).toBeNull()
  })

  it('counts the members queued for the zone', async () => {
    setup({ vms: [vm(100, 'web-1', [])], pending_members: [{ id: 'm1', policy_id: 'p1', node: 'pve1', type: 'qemu', vmid: 100, zone_id: 'zw' }] })
    await waitFor(async () => expect(within(await node('zone:zw')).getByText('1 member')).toBeTruthy())
  })

  it('shows the state of the zone', async () => {
    setup({ zones: [web({ state: 'enforce' }), db({ state: 'disabled' })] })
    expect((await node('zone:zw')).querySelector('[data-state="enforce"]')).toBeTruthy()
    expect((await node('zone:zd')).querySelector('[data-state="disabled"]')).toBeTruthy()
  })

  it('marks a draft with unapplied changes, and only then', async () => {
    const first = setup({ pending_changes: true })
    expect(await screen.findByText('Draft with unapplied changes')).toBeTruthy()
    first.unmount()
    setup({ pending_changes: false })
    await node('zone:zw')
    expect(screen.queryByText('Draft with unapplied changes')).toBeNull()
  })

  it('says so when there is no zone yet, and leads to the Policy sub-tab', async () => {
    setup({ zones: [] })
    expect(await screen.findByText('No zone to draw yet.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Create a zone' }))
    expect(await screen.findByRole('button', { name: 'New zone' })).toBeTruthy()
    expect(window.localStorage.getItem('microseg.subTab')).toBe('policy')
  })
})

describe('edges', () => {
  it('draws the flows of a pair as one solid edge labelled with the protocols and ports', async () => {
    setup({ flows: [flowOf('f1'), flowOf('f2', { proto: 'udp', dport: '53' })] })
    const path = await pathOf('flow:zone:zw>zone:zd')
    expect(path.getAttribute('data-dash')).toBe('')
    expect(screen.getAllByTestId(/^edge-/)).toHaveLength(1)
    expect(await screen.findByText('tcp/443, udp/53')).toBeTruthy()
  })

  it('draws the pending would_block suggestions as a dashed red edge', async () => {
    setup({ suggestions: [wouldBlock('s1'), wouldBlock('s2', { dport: '22' })] })
    const path = await pathOf('pending:zone:zw>zone:zd')
    expect(path.getAttribute('data-dash')).not.toBe('')
    expect(path.getAttribute('data-stroke')).toBe('#f44336')
    expect(await screen.findByText('tcp/22, tcp/80')).toBeTruthy()
  })

  it('shows the draft: a flow that is not applied yet is on the map', async () => {
    setup({ flows: [flowOf('f1')], pending_changes: true })
    expect(await pathOf('flow:zone:zw>zone:zd')).toBeTruthy()
  })

  it('adds an External node for a CIDR source and for a source in no zone', async () => {
    setup({ flows: [flowOf('f1', { src_zone_id: '', src_cidr: '203.0.113.0/24' })], suggestions: [wouldBlock('s1', { src_zone_id: '' })] })
    const ext = await node('external')
    expect(within(ext).getByText('External')).toBeTruthy()
    expect(await pathOf('flow:external>zone:zd')).toBeTruthy()
    expect(await pathOf('pending:external>zone:zd')).toBeTruthy()
  })

  it('draws a CIDR destination as a dashed grey edge to an Outside node labelled not applied in v1', async () => {
    setup({ flows: [flowOf('f1', { dst_zone_id: '', dst_cidr: '8.8.8.0/24', proto: 'udp', dport: '53' })] })
    const out = await node('outside')
    expect(within(out).getByText('Outside')).toBeTruthy()
    expect(within(out).getByText('not applied in v1')).toBeTruthy()
    const path = await pathOf('outside:zone:zw>outside')
    expect(path.getAttribute('data-dash')).not.toBe('')
    expect(path.getAttribute('data-stroke')).toBe('#9e9e9e')
  })

  it('has no External or Outside node when every end is a zone', async () => {
    setup({ flows: [flowOf('f1')] })
    await pathOf('flow:zone:zw>zone:zd')
    expect(screen.queryByTestId('node-external')).toBeNull()
    expect(screen.queryByTestId('node-outside')).toBeNull()
  })

  it('animates an allowed flow with a particle that follows the edge', async () => {
    setup({ flows: [flowOf('f1')], suggestions: [wouldBlock('s1')] })
    const g = await screen.findByTestId('edge-flow:zone:zw>zone:zd')
    expect(g.querySelector('animateMotion')).toBeTruthy()
    expect(screen.getByTestId('edge-pending:zone:zw>zone:zd').querySelector('animateMotion')).toBeNull()
  })

  it('stops every animation under prefers-reduced-motion', async () => {
    reduceMotion()
    setup({ flows: [flowOf('f1')], suggestions: [wouldBlock('s1')] })
    await pathOf('flow:zone:zw>zone:zd')
    expect(document.querySelector('animateMotion')).toBeNull()
    expect(document.querySelector('animate')).toBeNull()
  })

  it('keeps the allowed flows on the map when the suggestions cannot be read, and says so', async () => {
    setup({ flows: [flowOf('f1')], suggestions: 'error' })
    expect(await pathOf('flow:zone:zw>zone:zd')).toBeTruthy()
    expect(await screen.findByText(/pending flows could not be read/i)).toBeTruthy()
  })
})

describe('requests', () => {
  it('reads the pending would_block suggestions with ONE call, and nothing per zone', async () => {
    setup({ zones: [web(), db(), { ...db(), id: 'zx', name: 'cache' }], flows: [flowOf('f1')], suggestions: [wouldBlock('s1')] })
    await pathOf('pending:zone:zw>zone:zd')
    fireEvent.click(await node('zone:zw'))
    await screen.findByRole('complementary', { name: 'Zone web' })
    const suggestionCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/suggestions'))
    expect(suggestionCalls).toHaveLength(1)
    expect(calls(SUGGESTIONS)).toHaveLength(1)
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === GUESTS_ROUTE)).toHaveLength(1)
  })
})

describe('side panel', () => {
  const members = Array.from({ length: 12 }, (_, i) => vm(100 + i, `web-${String(i).padStart(2, '0')}`, ['zone-web']))

  it('opens on a zone with its members (status glyph, vmid, node) and the flows in and out', async () => {
    setup({
      flows: [flowOf('f1'), flowOf('f2', { src_zone_id: 'zd', dst_zone_id: 'zw', dport: '5432' })],
      vms: [vm(100, 'web-1', ['zone-web']), vm(101, 'ct-1', ['zone-web'], { type: 'lxc', status: 'stopped', node: 'pve2' })],
    })
    fireEvent.click(await node('zone:zw'))
    const panel = await screen.findByRole('complementary', { name: 'Zone web' })
    const member = await within(panel).findByRole('listitem', { name: 'web-1' })
    expect(member.querySelector('i.ri-computer-fill')).toBeTruthy()
    expect(within(member).getByText('100 · pve1')).toBeTruthy()
    const ct = within(panel).getByRole('listitem', { name: 'ct-1' })
    expect(ct.querySelector('i.ri-instance-fill')).toBeTruthy()
    expect(within(panel).getByText('Incoming flows')).toBeTruthy()
    expect(within(panel).getByText('Outgoing flows')).toBeTruthy()
    expect(within(panel).getByText('tcp/443')).toBeTruthy()
    expect(within(panel).getByText('tcp/5432')).toBeTruthy()
  })

  it('paginates the members ten per page', async () => {
    setup({ vms: members })
    fireEvent.click(await node('zone:zw'))
    const panel = await screen.findByRole('complementary', { name: 'Zone web' })
    expect(await within(panel).findByText('web-00')).toBeTruthy()
    expect(within(panel).queryByText('web-10')).toBeNull()
    expect(within(panel).getAllByRole('listitem')).toHaveLength(10)
    fireEvent.click(within(panel).getByRole('button', { name: 'Next page' }))
    expect(await within(panel).findByText('web-10')).toBeTruthy()
    expect(within(panel).queryByText('web-00')).toBeNull()
  })

  it('says so when the zone has no member and when the guests cannot be read', async () => {
    setup()
    fireEvent.click(await node('zone:zw'))
    expect(await screen.findByText('No members')).toBeTruthy()
  })

  it('switches to the Policy sub-tab with "Edit in Policy"', async () => {
    setup()
    fireEvent.click(await node('zone:zw'))
    fireEvent.click(await screen.findByRole('button', { name: 'Edit in Policy' }))
    expect(await screen.findByRole('button', { name: 'New zone' })).toBeTruthy()
    expect(window.localStorage.getItem('microseg.subTab')).toBe('policy')
  })

  it('opens the assign dialog of the zone with "Assign guests"', async () => {
    setup({ vms: [vm(100, 'web-1', [])] })
    fireEvent.click(await node('zone:zw'))
    fireEvent.click(await screen.findByRole('button', { name: 'Assign guests' }))
    const dialog = await screen.findByRole('dialog', { name: 'Assign guests to web' })
    expect(await within(dialog).findByText('web-1')).toBeTruthy()
  })

  it('closes with the close button and with a click on the canvas, and follows another zone', async () => {
    setup()
    fireEvent.click(await node('zone:zw'))
    await screen.findByRole('complementary', { name: 'Zone web' })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('complementary')).toBeNull()

    fireEvent.click(await node('zone:zw'))
    fireEvent.click(await node('zone:zd'))
    expect(await screen.findByRole('complementary', { name: 'Zone db' })).toBeTruthy()
    fireEvent.click(screen.getByTestId('flow'))
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('does not open for the External or the Outside node', async () => {
    setup({ flows: [flowOf('f1', { src_zone_id: '', src_cidr: '10.0.0.0/8' })] })
    fireEvent.click(await node('external'))
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('assigns from the panel, then shows the queued member of the zone', async () => {
    mock.routes['POST /members'] = () => reply(200, { version: 4 })
    setup({ vms: [vm(100, 'web-1', [])] })
    fireEvent.click(await node('zone:zw'))
    fireEvent.click(await screen.findByRole('button', { name: 'Assign guests' }))
    const dialog = await screen.findByRole('dialog', { name: 'Assign guests to web' })
    fireEvent.click(await within(dialog).findByRole('checkbox', { name: 'web-1' }))
    mock.routes['GET /policy'] = () => reply(200, policy({
      zones: [web(), db()], last_revision: REVISION_HEAD, pending_changes: true,
      pending_members: [{ id: 'm1', policy_id: 'p1', node: 'pve1', type: 'qemu', vmid: 100, zone_id: 'zw' }],
    }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Assign 1 guest' }))

    await waitFor(() => expect(calls('POST /members')).toHaveLength(1))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const panel = screen.getByRole('complementary', { name: 'Zone web' })
    const line = await within(panel).findByRole('listitem', { name: 'web-1' })
    expect(within(line).getByText('Pending')).toBeTruthy()
    expect(await screen.findByText('Draft with unapplied changes')).toBeTruthy()
  })

  it('closes the panel of a zone that is gone from the draft after a reload', async () => {
    mock.routes['POST /members'] = () => reply(200, { version: 4 })
    setup({ vms: [vm(100, 'web-1', [])] })
    fireEvent.click(await node('zone:zw'))
    fireEvent.click(await screen.findByRole('button', { name: 'Assign guests' }))
    const dialog = await screen.findByRole('dialog', { name: 'Assign guests to web' })
    fireEvent.click(await within(dialog).findByRole('checkbox', { name: 'web-1' }))
    mock.routes['GET /policy'] = () => reply(200, policy({ zones: [db()], last_revision: REVISION_HEAD }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Assign 1 guest' }))

    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull())
    expect(screen.queryByTestId('node-zone:zw')).toBeNull()
  })
})
