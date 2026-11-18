/**
 * Overview sub-tab of a policy shared by several clusters: the map draws the guests and the nodes of every cluster the
 * user sees (zone circles, the inside of a zone, the node view grouped per cluster), says which cluster a guest is on,
 * shows the others when one cluster cannot be read, never reads a cluster outside the user's scope, and leaves a
 * policy of one cluster exactly as it was (same requests, same nodes).
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, within } from '@testing-library/react'

import { fireEvent, screen, waitFor } from '@/__tests__/setup/renderWithProviders'

import { ConnectionKindsContext, type ConnectionKind } from './ConnectionGlyph'
import { BASE, fetchMock, mock, policy, renderTab, reply, resetMocks, GUESTS_ROUTE, REVISION_HEAD } from './microsegTestKit'
import MicrosegTab from './MicrosegTab'
import { db, vm, web } from './policyTestKit'
import { flowOf, node, pathOf, SUGGESTIONS, wouldBlock } from './zoneMapTestKit'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const CONNECTIONS = [{ id: 'c1', name: 'PVE-PROD' }, { id: 'c2', name: 'PVE-DR' }]
const link = (connection_id: string) =>
  ({ connection_id, active: true, stop_cluster_disabled: false, policy_id: 'p1', created_at: '2026-11-01T10:00:00Z', activated_at: null })

// web holds web-prod (PROD qemu/100 on pve1) and web-dr (DR qemu/100 on pve1: the same VMID and node name); db-dr is on DR's pve2.
const PROD_VMS = [vm(100, 'web-prod', ['zone-web'], { ips: ['10.0.0.1'] })]
const DR_VMS = [vm(100, 'web-dr', ['zone-web'], { ips: ['10.0.0.3'] }), vm(200, 'db-dr', ['zone-db'], { ips: ['10.0.0.2'], node: 'pve2' })]
const OBSERVED = [wouldBlock('s1', { src_ip: '10.0.0.1', dst_ip: '10.0.0.2', hits: 5 })]
/** The node lists the page read for its connections: DR has an empty pve3. */
const KINDS: Record<string, ConnectionKind> = {
  c1: { kind: 'cluster', status: 'online', nodes: [{ node: 'pve1', status: 'online' }] },
  c2: { kind: 'cluster', status: 'online', nodes: [{ node: 'pve1', status: 'online' }, { node: 'pve2', status: 'online' }, { node: 'pve3', status: 'online' }] },
}

/** A policy shared by `links` (c1 opened), the Overview on `view`; `dr` a number fails DR's guest read. */
function setupShared(opts: { links?: string[]; dr?: unknown[] | number; view?: string } = {}) {
  resetMocks()
  const links = (opts.links ?? ['c1', 'c2']).map(link)
  window.localStorage.setItem('microseg.subTab', 'overview')
  if (opts.view) window.localStorage.setItem('microseg.map.view', opts.view)
  mock.routes['GET /clusters'] = () => reply(200, { clusters: links, max: 8 })
  mock.routes['GET /policy'] = () => reply(200, policy({ zones: [web(), db()], flows: [flowOf('f1')], last_revision: REVISION_HEAD, clusters: links }))
  mock.routes[SUGGESTIONS] = () => reply(200, { suggestions: OBSERVED, limit: 200, offset: 0 })
  mock.routes[`GET ${GUESTS_ROUTE}`] = () => reply(200, { data: { vms: PROD_VMS } })
  const dr = opts.dr ?? DR_VMS
  mock.routes['GET /api/v1/vms?connId=c2'] = () => (typeof dr === 'number' ? reply(dr, { error: 'down' }) : reply(200, { data: { vms: dr } }))
  return renderTab(
    <ConnectionKindsContext.Provider value={KINDS}>
      <MicrosegTab connectionId='c1' connections={CONNECTIONS} />
    </ConnectionKindsContext.Provider>,
  )
}

const urls = () => fetchMock.mock.calls.map(([u]) => String(u))
const pick = (name: string) => fireEvent.click(screen.getByRole('button', { name }))

describe('the zone view of a shared policy', () => {
  it('holds in a zone its members of every cluster, the same VMID on two clusters as two guests, counted together', async () => {
    setupShared()
    expect((await node('guest:zw:c1/qemu/100')).getAttribute('data-parent')).toBe('zone:zw')
    expect((await node('guest:zw:c2/qemu/100')).getAttribute('data-parent')).toBe('zone:zw')
    expect(within(await node('zone:zw')).getByText('2 members')).toBeTruthy()
    // The observed flow from PROD's web-prod to DR's db-dr goes from guest to guest.
    expect(await pathOf('unprotected:guest:zw:c1/qemu/100>guest:zd:c2/qemu/200')).toBeTruthy()
  })

  it('says on a guest which cluster it is on, in its tooltip and to a screen reader', async () => {
    setupShared()
    const guest = within(await node('guest:zw:c2/qemu/100')).getByRole('button', { name: 'web-dr, guest 100, PVE-DR' })
    fireEvent.mouseOver(guest)
    expect(await screen.findByText('Guest 100 on pve1, PVE-DR')).toBeTruthy()
  })

  it('shows the cluster of each member on its line of the zone panel', async () => {
    setupShared()
    fireEvent.click(await node('zone:zw'))
    const panel = await screen.findByRole('complementary', { name: 'Zone web' })
    const prod = await within(panel).findByRole('listitem', { name: /web-prod/ })
    expect(within(prod).getByText('PVE-PROD')).toBeTruthy()
    expect(within(within(panel).getByRole('listitem', { name: /web-dr/ })).getByText('PVE-DR')).toBeTruthy()
  })

  it('draws the guests of the other clusters when one cannot be read, and says in one line whose are missing', async () => {
    setupShared({ dr: 500 })
    expect(await screen.findByText('The guests of PVE-DR could not be read: they are not listed.')).toBeTruthy()
    expect(await node('guest:zw:c1/qemu/100')).toBeTruthy()
    expect(screen.queryByTestId('node-guest:zw:c2/qemu/100')).toBeNull()
  })

  it('never reads a cluster outside the user\'s scope, never names it, and says its guests are not shown', async () => {
    setupShared({ links: ['c1', 'secret-id'] })
    expect(await node('guest:zw:c1/qemu/100')).toBeTruthy()
    expect(await screen.findByText('The guests of 1 cluster outside your scope are not shown.')).toBeTruthy()
    expect(urls().some(u => u.includes('connId=secret-id'))).toBe(false)
    expect(document.body.textContent).not.toContain('secret-id')
  })
})

describe('the inside of a zone of a shared policy', () => {
  it('puts on its rings the guests of the zone of every cluster', async () => {
    setupShared()
    const zone = await node('zone:zw')
    fireEvent.click(zone)
    fireEvent.click(zone, { detail: 2 })
    expect(await screen.findByTestId('zone-inside-bar')).toBeTruthy()
    expect((await node('guest:zw:c1/qemu/100')).getAttribute('data-parent')).toBe('zone:zw')
    expect((await node('guest:zw:c2/qemu/100')).getAttribute('data-parent')).toBe('zone:zw')
  })
})

describe('the node view of a shared policy', () => {
  it('groups the nodes of each cluster under its name, a node name on two clusters as two nodes, the empty ones too', async () => {
    setupShared({ view: 'nodes' })
    const prod = await node('pvecluster:c1')
    const dr = await node('pvecluster:c2')
    expect(within(prod).getByRole('group', { name: 'PVE-PROD' })).toBeTruthy()
    expect(within(dr).getByText('PVE-DR')).toBeTruthy()
    expect(within(dr).getByTestId('connection-glyph-cluster')).toBeTruthy()
    expect((await node('guest:pve:c1/pve1:c1/qemu/100')).getAttribute('data-parent')).toBe('pve:c1/pve1')
    expect((await node('guest:pve:c2/pve1:c2/qemu/100')).getAttribute('data-parent')).toBe('pve:c2/pve1')
    // DR's pve3 holds no guest: drawn from the node list the page read, with its state.
    expect(within(await node('pve:c2/pve3')).getByText('0 guests')).toBeTruthy()
    expect(within(screen.getByTestId('node-pve:c2/pve3')).getByTestId('pve-icon').getAttribute('data-status')).toBe('online')
    expect(within(screen.getByTestId('node-pve:c2/pve1')).getByRole('group', { name: 'Proxmox node pve1 of PVE-DR, 1 guest' })).toBeTruthy()
  })

  it('draws the flows between nodes of two clusters, named with their cluster', async () => {
    setupShared({ view: 'nodes' })
    const id = 'unprotected:pve:c1/pve1>pve:c2/pve2'
    expect(await pathOf(id)).toBeTruthy()
    expect(screen.getByTestId(`edge-${id}`).getAttribute('aria-label')).toBe('pve1 (PVE-PROD) to pve2 (PVE-DR): 1 unprotected flow')
  })

  it('targets the guest of its own cluster on a click', async () => {
    setupShared({ view: 'nodes' })
    fireEvent.click(await node('guest:pve:c2/pve1:c2/qemu/100'))
    expect(await screen.findByRole('complementary', { name: 'Guest web-dr' })).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('node-guest:pve:c2/pve1:c2/qemu/100').className).toContain('microseg-target'))
    expect(screen.getByTestId('node-guest:pve:c1/pve1:c1/qemu/100').className).not.toContain('microseg-target')
  })
})

describe('a policy of one cluster', () => {
  async function settled() {
    let seen = -1
    while (seen !== fetchMock.mock.calls.length) {
      seen = fetchMock.mock.calls.length
      await new Promise(resolve => setTimeout(resolve, 400))
    }
  }

  it.each(['groups', 'nodes'])('keeps the requests and the nodes of the %s rendering as they were', async view => {
    resetMocks()
    window.localStorage.setItem('microseg.subTab', 'overview')
    window.localStorage.setItem('microseg.map.view', view)
    mock.routes['GET /clusters'] = () => reply(200, { clusters: [link('c1')], max: 8 })
    mock.routes['GET /policy'] = () => reply(200, policy({ zones: [web(), db()], flows: [flowOf('f1')], last_revision: REVISION_HEAD }))
    mock.routes[SUGGESTIONS] = () => reply(200, { suggestions: OBSERVED, limit: 200, offset: 0 })
    mock.routes[`GET ${GUESTS_ROUTE}`] = () => reply(200, { data: { vms: [...PROD_VMS, vm(200, 'db-1', ['zone-db'], { ips: ['10.0.0.2'], node: 'pve2' })] } })
    renderTab(
      <ConnectionKindsContext.Provider value={KINDS}>
        <MicrosegTab connectionId='c1' connections={CONNECTIONS} />
      </ConnectionKindsContext.Provider>,
    )
    const ids = view === 'nodes' ? ['pve:pve1', 'pve:pve2', 'guest:pve:pve1:qemu/100', 'guest:pve:pve2:qemu/200'] : ['zone:zw', 'zone:zd', 'guest:zw:qemu/100', 'guest:zd:qemu/200']
    for (const id of ids) expect(await node(id)).toBeTruthy()
    await settled()

    expect(urls().sort()).toEqual([
      `${BASE}/clusters`, `${BASE}/policy`, `${BASE}/runs?limit=100`, `${BASE}/status`, `${BASE}/suggestions?status=pending&limit=200`, GUESTS_ROUTE,
    ].sort())
    expect(screen.queryAllByTestId(/^node-pvecluster:/)).toHaveLength(0)
    expect(screen.queryAllByTestId(/^node-guest:.*c1\//)).toHaveLength(0)
    expect(screen.queryByText(/outside your scope/)).toBeNull()
    expect(screen.queryByText(/could not be read/)).toBeNull()
    expect(screen.getAllByTestId(/^node-/).map(n => n.getAttribute('data-testid')).sort()).toEqual(ids.map(id => `node-${id}`).sort())
  })
})
