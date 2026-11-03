/**
 * Overview sub-tab, the NSX-like map: guests inside their zone circle, the guests in no zone, observed flows guest
 * to guest, the three flow checkboxes, the focus mode, the panel of a clicked edge, the canvas controls, the refresh.
 */

import { describe, expect, it, vi } from 'vitest'
import { within } from '@testing-library/react'

import { screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'

import { calls, fetchMock, mock, policy, reply, GUESTS_ROUTE, REVISION_HEAD } from './microsegTestKit'
import { db, installFreshMocks, vm, web } from './policyTestKit'
import { flowOf, node, pathOf, setup, SUGGESTIONS, wouldBlock } from './zoneMapTestKit'

installFreshMocks()

const body = (init: unknown) => JSON.parse(String((init as RequestInit).body))
const dimmed = (testId: string) => screen.getByTestId(testId).classList.contains('microseg-dim')
const withIps = [
  vm(100, 'web-1', ['zone-web'], { ips: ['10.0.0.1/24'] }),
  vm(101, 'web-2', ['zone-web'], { ips: ['10.0.0.3'] }),
  vm(200, 'db-1', ['zone-db'], { ips: ['10.0.0.2'] }),
]

describe('guests on the map', () => {
  it('draws the members of a zone inside its circle, with their name', async () => {
    setup({ vms: withIps })
    const g = await node('guest:zw:qemu/100')
    expect(g.getAttribute('data-parent')).toBe('zone:zw')
    expect(within(g).getByText('web-1')).toBeTruthy()
    expect(within(g).getByRole('button', { name: 'web-1, guest 100' })).toBeTruthy()
    expect((await node('guest:zd:qemu/200')).getAttribute('data-parent')).toBe('zone:zd')
  })

  it('collapses past 12 members into 11 guests and a "+N" that opens the panel of the zone', async () => {
    setup({ vms: Array.from({ length: 15 }, (_, i) => vm(100 + i, `web-${String(i).padStart(2, '0')}`, ['zone-web'])) })
    const more = await node('more:zw')
    expect(within(more).getByText('+4')).toBeTruthy()
    expect(screen.getAllByTestId(/^node-guest:zw:/)).toHaveLength(11)
    fireEvent.click(more)
    expect(await screen.findByRole('complementary', { name: 'Zone web' })).toBeTruthy()
  })

  it('draws the running guests in no zone in their own circle, which opens no panel', async () => {
    setup({ vms: [...withIps, vm(900, 'lost-1', []), vm(901, 'lost-2', ['other']), vm(902, 'off', [], { status: 'stopped' })] })
    const unzoned = await node('unzoned')
    expect(within(unzoned).getByText('Unzoned guests (2)')).toBeTruthy()
    expect(within(unzoned).getByRole('group', { name: 'Unzoned guests (2)' })).toBeTruthy()
    expect(await node('guest:unzoned:qemu/900')).toBeTruthy()
    expect(screen.queryByTestId('node-guest:unzoned:qemu/902')).toBeNull()
    fireEvent.click(unzoned)
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('draws an observed flow from the guest to the guest its addresses belong to', async () => {
    setup({ vms: withIps, suggestions: [wouldBlock('s1', { src_ip: '10.0.0.1', dst_ip: '10.0.0.2', dport: '5432' })] })
    const path = await pathOf('unprotected:guest:zw:qemu/100>guest:zd:qemu/200')
    expect(path.getAttribute('data-dash')).not.toBe('')
    expect(await screen.findByText('PostgreSQL')).toBeTruthy()
    expect(screen.getByTestId('edge-unprotected:guest:zw:qemu/100>guest:zd:qemu/200').getAttribute('aria-label')).toBe('web-1 (web) to db-1 (db): 1 unprotected flow')
  })

  it('highlights the flows of a clicked guest without opening a panel', async () => {
    setup({ vms: withIps, flows: [flowOf('f1')], suggestions: [wouldBlock('s1', { src_ip: '10.0.0.1', dst_ip: '10.0.0.2' })] })
    const id = 'unprotected:guest:zw:qemu/100>guest:zd:qemu/200'
    await pathOf(id)
    fireEvent.click(await node('guest:zw:qemu/101'))
    expect(dimmed(`edge-${id}`)).toBe(true)
    expect(dimmed('node-guest:zw:qemu/101')).toBe(false)
    fireEvent.click(await node('guest:zw:qemu/100'))
    expect(dimmed(`edge-${id}`)).toBe(false)
    expect(dimmed('edge-allowed:zone:zw>zone:zd')).toBe(true)
    expect(within(await node('guest:zw:qemu/100')).getByRole('button', { name: 'web-1, guest 100' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('complementary')).toBeNull()
  })
})

describe('flow checkboxes', () => {
  it('hides and shows each kind of flow, all on at first, and remembers the choice', async () => {
    const opts = { flows: [flowOf('f1')], suggestions: [wouldBlock('s1'), wouldBlock('s2', { kind: 'blocked' as const })] }
    const first = setup(opts)
    await pathOf('unprotected:zone:zw>zone:zd')
    for (const name of ['Unprotected', 'Blocked', 'Allowed']) expect((screen.getByRole('checkbox', { name }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Unprotected' }))
    await waitFor(() => expect(screen.queryByTestId('edge-unprotected:zone:zw>zone:zd')).toBeNull())
    expect(screen.getByTestId('edge-blocked:zone:zw>zone:zd')).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Allowed' }))
    await waitFor(() => expect(screen.queryByTestId('edge-allowed:zone:zw>zone:zd')).toBeNull())
    first.unmount()

    setup(opts)
    await pathOf('blocked:zone:zw>zone:zd')
    expect(screen.queryByTestId('edge-unprotected:zone:zw>zone:zd')).toBeNull()
    expect((screen.getByRole('checkbox', { name: 'Unprotected' }) as HTMLInputElement).checked).toBe(false)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Unprotected' }))
    expect(await pathOf('unprotected:zone:zw>zone:zd')).toBeTruthy()
  })

  it('keeps every flow drawn when the storage of the browser refuses to work', async () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage')!
    const broken = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') }, removeItem: () => undefined, clear: () => undefined }
    setup({ flows: [flowOf('f1')], suggestions: [wouldBlock('s1')] })
    Object.defineProperty(window, 'localStorage', { configurable: true, value: broken })
    try {
      expect(await pathOf('unprotected:zone:zw>zone:zd')).toBeTruthy()
      fireEvent.click(screen.getByRole('checkbox', { name: 'Unprotected' }))
      await waitFor(() => expect(screen.queryByTestId('edge-unprotected:zone:zw>zone:zd')).toBeNull())
    } finally {
      Object.defineProperty(window, 'localStorage', original)
    }
  })
})

describe('focus mode', () => {
  const three = () => setup({
    zones: [web(), db(), { ...db(), id: 'zx', name: 'cache' }],
    flows: [flowOf('f1'), flowOf('f2', { src_zone_id: 'zd', dst_zone_id: 'zx' })],
  })

  it('dims what is not linked to the zone under the pointer, then nothing once it leaves', async () => {
    three()
    await pathOf('allowed:zone:zd>zone:zx')
    fireEvent.mouseEnter(await node('zone:zw'))
    expect(dimmed('edge-allowed:zone:zd>zone:zx')).toBe(true)
    expect(dimmed('node-zone:zx')).toBe(true)
    expect(dimmed('edge-allowed:zone:zw>zone:zd')).toBe(false)
    expect(dimmed('node-zone:zd')).toBe(false)
    fireEvent.mouseLeave(await node('zone:zw'))
    expect(dimmed('edge-allowed:zone:zd>zone:zx')).toBe(false)
    expect(dimmed('node-zone:zx')).toBe(false)
  })

  it('keeps the focus on the selected zone and on the zone the keyboard is on, and clears it on the canvas', async () => {
    three()
    await pathOf('allowed:zone:zd>zone:zx')
    fireEvent.click(await node('zone:zx'))
    expect(dimmed('node-zone:zw')).toBe(true)
    expect(dimmed('edge-allowed:zone:zd>zone:zx')).toBe(false)
    fireEvent.click(screen.getByTestId('flow'))
    expect(dimmed('node-zone:zw')).toBe(false)

    fireEvent.focus(screen.getByRole('button', { name: /^Zone web,/ }))
    expect(dimmed('node-zone:zx')).toBe(true)
    fireEvent.blur(screen.getByRole('button', { name: /^Zone web,/ }))
    expect(dimmed('node-zone:zx')).toBe(false)
  })

  it('lights an edge under the pointer and its two ends', async () => {
    three()
    const edge = await screen.findByTestId('edge-allowed:zone:zd>zone:zx')
    fireEvent.mouseEnter(edge)
    expect(dimmed('node-zone:zw')).toBe(true)
    expect(dimmed('node-zone:zd')).toBe(false)
    expect(dimmed('edge-allowed:zone:zw>zone:zd')).toBe(true)
  })
})

describe('panel of an edge', () => {
  const observed = () => {
    mock.routes['POST /suggestions/resolve'] = () => reply(200, { version: 4 })
    setup({ vms: withIps, suggestions: [wouldBlock('s1', { src_ip: '10.0.0.1', dst_ip: '10.0.0.2', hits: 14 })] })
  }
  const open = async () => {
    fireEvent.click(await screen.findByTestId('edge-unprotected:guest:zw:qemu/100>guest:zd:qemu/200'))
    return screen.findByRole('complementary', { name: 'Flow web-1 (web) to db-1 (db)' })
  }

  it('says the guest pair is an example of the zone pair, one line per flow, the details under the chevron', async () => {
    observed()
    const panel = await open()
    expect(within(panel).getByText('Example: web-1 → db-1')).toBeTruthy()
    expect(within(panel).getByText('The engine keeps one sample pair of guests per observed flow: the hits count the whole zone pair.')).toBeTruthy()
    const row = within(panel).getByRole('listitem', { name: 'web to db' })
    expect(within(row).getByText('web → db')).toBeTruthy()
    expect(within(row).getByText('HTTP')).toBeTruthy()
    expect(within(row).getByText('14 hits')).toBeTruthy()
    expect(within(row).queryByText('Pending')).toBeNull()
    expect(within(row).queryByText(/^First seen/)).toBeNull()
    fireEvent.click(within(row).getByRole('button', { name: 'Show details' }))
    expect(await within(row).findByText('14 hits between zone web and zone db on HTTP (tcp/80) (sample pair shown)')).toBeTruthy()
    expect(within(row).getByText('Example: web-1 → db-1')).toBeTruthy()
    expect(within(row).getByText('Sample addresses: 10.0.0.1 → 10.0.0.2')).toBeTruthy()
    expect(within(row).getByText(/^First seen/)).toBeTruthy()
    expect(within(row).getByText(/^Last seen/)).toBeTruthy()
    expect(within(row).getByText('Status: Pending')).toBeTruthy()
  })

  it('says where an unknown source came from, without a sample pair of guests', async () => {
    setup({ suggestions: [wouldBlock('s1', { src_zone_id: '', src_ip: '203.0.113.9', hits: 2 })] })
    fireEvent.click(await screen.findByTestId('edge-unprotected:external>zone:zd'))
    const panel = await screen.findByRole('complementary', { name: 'Flow Unknown / External to db' })
    expect(within(panel).queryByText(/^Example:/)).toBeNull()
    const row = within(panel).getByRole('listitem', { name: '203.0.113.9 to db' })
    fireEvent.click(within(row).getByRole('button', { name: 'Show details' }))
    expect(await within(row).findByText('2 hits from 203.0.113.9 to zone db on HTTP (tcp/80)')).toBeTruthy()
    expect(within(panel).queryByText(/sample pair/)).toBeNull()
  })

  it('opens from the keyboard: the label of an edge is a button named after the flow', async () => {
    observed()
    const label = await screen.findByRole('button', { name: 'web-1 (web) to db-1 (db): 1 unprotected flow' })
    expect(label.getAttribute('tabindex')).toBe('0')
    fireEvent.keyDown(label, { key: 'a' })
    expect(screen.queryByRole('complementary')).toBeNull()
    fireEvent.keyDown(label, { key: 'Enter' })
    expect(await screen.findByRole('complementary', { name: 'Flow web-1 (web) to db-1 (db)' })).toBeTruthy()
  })

  it('opens the panel of an allowed edge with Space on its label', async () => {
    setup({ flows: [flowOf('f1')] })
    fireEvent.keyDown(await screen.findByRole('button', { name: 'web to db: HTTPS (tcp/443)' }), { key: ' ' })
    expect(await screen.findByRole('complementary', { name: 'Flow web to db' })).toBeTruthy()
  })

  it('accepts it as a flow of the zones, reloads, then says so once the edge is gone', async () => {
    observed()
    const panel = await open()
    const before = calls(SUGGESTIONS).length
    mock.routes[SUGGESTIONS] = () => reply(200, { suggestions: [], limit: 200, offset: 0 })
    fireEvent.click(within(panel).getByRole('button', { name: 'Accept as flow web → db HTTP (tcp/80)' }))
    await waitFor(() => expect(calls('POST /suggestions/resolve')).toHaveLength(1))
    expect(body(calls('POST /suggestions/resolve')[0][1])).toEqual({ version: 3, ids: ['s1'], action: 'accept' })
    expect(await screen.findByText('1 flow accepted into the draft')).toBeTruthy()
    await waitFor(() => expect(calls(SUGGESTIONS).length).toBeGreaterThan(before))
    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull())
  })

  it('accepts as a CIDR and dismisses with the same route', async () => {
    observed()
    fireEvent.click(within(await open()).getByRole('button', { name: 'Accept as CIDR' }))
    await waitFor(() => expect(calls('POST /suggestions/resolve')).toHaveLength(1))
    expect(body(calls('POST /suggestions/resolve')[0][1]).action).toBe('accept_cidr')
    fireEvent.click(within(await screen.findByRole('complementary')).getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(calls('POST /suggestions/resolve')).toHaveLength(2))
    expect(body(calls('POST /suggestions/resolve')[1][1]).action).toBe('dismiss')
  })

  it('cannot accept as a flow a source in no zone', async () => {
    setup({ suggestions: [wouldBlock('s1', { src_zone_id: '', src_ip: '203.0.113.9' })] })
    fireEvent.click(await screen.findByTestId('edge-unprotected:external>zone:zd'))
    const panel = await screen.findByRole('complementary', { name: 'Flow Unknown / External to db' })
    expect((within(panel).getByRole('button', { name: /^Accept as flow/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(panel).getByRole('button', { name: 'Accept as CIDR' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows the server message of a 400, and reloads the draft on a 409', async () => {
    observed()
    mock.routes['POST /suggestions/resolve'] = () => reply(400, { code: 'INVALID', error: 'suggestion s1 is gone' })
    const panel = await open()
    fireEvent.click(within(panel).getByRole('button', { name: 'Dismiss' }))
    expect(await within(panel).findByText(/suggestion s1 is gone/)).toBeTruthy()

    mock.routes['POST /suggestions/resolve'] = () => reply(409, { code: 'VERSION_CONFLICT', error: 'x' })
    const before = calls('GET /policy').length
    fireEvent.click(within(panel).getByRole('button', { name: 'Dismiss' }))
    expect(await within(panel).findByText(/changed elsewhere and was reloaded/)).toBeTruthy()
    await waitFor(() => expect(calls('GET /policy').length).toBeGreaterThan(before))
  })

  it('shows the flows of an allowed edge, the ones of the draft marked, with Edit in Policy', async () => {
    setup({ flows: [flowOf('f1'), flowOf('f2', { dport: '22' })], pending_changes: true, last_revision: null })
    const path = await pathOf('allowed:zone:zw>zone:zd')
    expect(path.getAttribute('data-dash')).toBe('1 5')
    fireEvent.click(screen.getByTestId('edge-allowed:zone:zw>zone:zd'))
    const panel = await screen.findByRole('complementary', { name: 'Flow web to db' })
    expect(within(panel).getAllByText('Draft')).toHaveLength(2)
    fireEvent.click(within(panel).getByRole('button', { name: 'Edit in Policy' }))
    expect(await screen.findByRole('button', { name: 'New zone' })).toBeTruthy()
  })

  it('marks only the flows the last applied revision does not have', async () => {
    mock.routes['GET /revisions?limit=1'] = () => reply(200, { revisions: [{ ...REVISION_HEAD, snapshot: { tag_prefix: 'zone-', zones: [web(), db()], flows: [flowOf('f1')] } }] })
    setup({ flows: [flowOf('f1'), flowOf('f2', { dst_zone_id: 'zx' })], zones: [web(), db(), { ...db(), id: 'zx', name: 'cache' }], pending_changes: true })
    await waitFor(async () => expect((await pathOf('allowed:zone:zw>zone:zx')).getAttribute('data-dash')).toBe('1 5'))
    expect((await pathOf('allowed:zone:zw>zone:zd')).getAttribute('data-dash')).toBe('')
  })

  it('opens the panel from the label of the edge too', async () => {
    setup({ flows: [flowOf('f1')] })
    fireEvent.click(await screen.findByText('HTTPS'))
    expect(await screen.findByRole('complementary', { name: 'Flow web to db' })).toBeTruthy()
  })
})

describe('canvas tools', () => {
  it('has the zoom and fit controls and the mini-map', async () => {
    setup()
    expect(await screen.findByTestId('flow-controls')).toBeTruthy()
    expect(screen.getByTestId('flow-minimap')).toBeTruthy()
  })

  it('says when it was refreshed and reads the policy, the observed flows and the guests again on Refresh', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-02T10:00:00Z'))
    setup({ flows: [flowOf('f1')] })
    await pathOf('allowed:zone:zw>zone:zd')
    const first = (await screen.findByText(/^Refreshed at /)).textContent
    vi.setSystemTime(new Date('2026-11-02T10:07:30Z'))
    const count = (route: string) => fetchMock.mock.calls.filter(([url]) => String(url).endsWith(route)).length
    const before = [calls('GET /policy').length, calls(SUGGESTIONS).length, count(GUESTS_ROUTE)]
    mock.routes['GET /policy'] = () => reply(200, policy({ zones: [web(), db()], flows: [flowOf('f1')], last_revision: REVISION_HEAD }))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh the map' }))
    await waitFor(() => {
      expect(calls('GET /policy').length).toBeGreaterThan(before[0])
      expect(calls(SUGGESTIONS).length).toBeGreaterThan(before[1])
      expect(count(GUESTS_ROUTE)).toBeGreaterThan(before[2])
    })
    // Nothing changed in the answers, the time still moves.
    await waitFor(() => expect(screen.getByText(/^Refreshed at /).textContent).not.toBe(first))
    vi.useRealTimers()
  })
})
