/**
 * The lists of a policy shared by two clusters, each read through its own cluster and merged: drifts, history, observed
 * flows, the banner and "Check now". A cluster that cannot be read loses its rows and says so on one line, the other
 * keeps working; a policy of one cluster shows no chip and no cluster filter.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, within } from '@testing-library/react'

import { fireEvent, screen, waitFor } from '@/__tests__/setup/renderWithProviders'
import type { MicrosegDrift, MicrosegRevision, MicrosegRun } from '@/lib/microseg/types'

// The kit first: it mocks the map's stylesheet before MicrosegTab is loaded.
import { GUESTS_ROUTE, calls, mock, policy, renderTab, reply, resetMocks, status, zone, REVISION_HEAD } from './microsegTestKit'
import { suggestion, vm } from './policyTestKit'
import { mergeClusterEvents } from '../MicrosegEventsView'
import { driftKey } from './driftLabels'
import DriftsPanel from './DriftsPanel'
import PreflightPanel from './PreflightPanel'
import HistoryPanel from './HistoryPanel'
import MicrosegTab from './MicrosegTab'
import ObservationPanel from './ObservationPanel'

const C2 = '/api/v1/firewall/microseg/c2'
const NAMES: Record<string, string> = { c1: 'PVE-PROD', c2: 'PVE-DR' }
const clusterName = (id: string) => NAMES[id] ?? id
const CONNECTIONS = [{ id: 'c1', name: 'PVE-PROD' }, { id: 'c2', name: 'PVE-DR' }]
const shared = { anchor: 'c1', clusterIds: ['c1', 'c2'], clusterName }
const handlers = () => ({ reloadPolicy: vi.fn(async () => undefined), startRun: vi.fn(), goToSubTab: vi.fn(), onOpenPlan: vi.fn() })
const link = (connection_id: string, active = true) => ({ connection_id, active, stop_cluster_disabled: false, policy_id: 'p1', created_at: '', activated_at: null })

beforeEach(resetMocks)
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
const originalTZ = process.env.TZ
beforeAll(() => { process.env.TZ = 'UTC' })
afterAll(() => {
  if (originalTZ === undefined) delete process.env.TZ
  else process.env.TZ = originalTZ
})

/** Every URL the relay was asked for. */
const fetchedUrls = () => (globalThis.fetch as unknown as { mock: { calls: [string][] } }).mock.calls.map(([u]) => String(u))
const g = (vmid: number) => ({ node: 'pve1', type: 'qemu' as const, vmid })
const driftRows = () => screen.queryAllByRole('row').filter(r => (r.getAttribute('aria-label') ?? '').includes(': '))

function driftsSetup(c1: MicrosegDrift[], c2: MicrosegDrift[] | number) {
  mock.routes['GET /drifts'] = () => reply(200, { drifts: c1, computed: true })
  mock.routes[`GET ${C2}/drifts`] = () => (typeof c2 === 'number' ? reply(c2, { code: 'ORCHESTRATOR_UNREACHABLE', error: 'down' }) : reply(200, { drifts: c2, computed: true }))
  mock.routes[`GET ${C2}/status`] = () => reply(200, status())
  mock.routes[`GET ${GUESTS_ROUTE}`] = () => reply(200, { data: { vms: [vm(100, 'web-prod', [])] } })
  mock.routes['GET /api/v1/vms?connId=c2'] = () => reply(200, { data: { vms: [vm(100, 'web-dr', [])] } })
}

describe('drifts of a shared policy', () => {
  it('keeps both rows when two clusters report the same guest VMID, each after its cluster chip', async () => {
    driftsSetup([{ kind: 'unzoned_running', guest: g(100) }], [{ kind: 'unzoned_running', guest: g(100) }])
    renderTab(<DriftsPanel connectionId='c1' policy={policy({ zones: [zone('zw', { name: 'web' })] })} {...handlers()} {...shared} />)
    expect((await screen.findByTestId('drift-group-unzoned_running')).textContent).toBe('Running guests in no zone (2)')
    await waitFor(() => expect(driftRows().map(r => r.getAttribute('aria-label'))).toEqual(expect.arrayContaining([
      expect.stringContaining('web-prod'), expect.stringContaining('web-dr'),
    ])))
    const [prod, dr] = driftRows()
    expect(within(prod).getByText('PVE-PROD')).toBeTruthy()
    expect(within(dr).getByText('PVE-DR')).toBeTruthy()
  })

  it('names an associated cluster that cannot be read as the user knows it, with no fix and no Ignore', async () => {
    driftsSetup([{ kind: 'peer_unreadable', object: 'c2', detail: { name: 'name-sent-by-the-backend' } }], [])
    renderTab(<DriftsPanel connectionId='c1' policy={policy()} {...handlers()} {...shared} />)
    await waitFor(() => expect(driftRows()).toHaveLength(1))
    const row = driftRows()[0]
    expect(within(row).getByTestId('drift-differs').textContent).toBe('Cluster PVE-DR cannot be read: address removals are on hold')
    expect(row.textContent).not.toContain('name-sent-by-the-backend')
    expect(within(row).queryByRole('button', { name: 'Ignore' })).toBeNull()
    expect(within(row).queryByRole('button', { name: /Open the plan|Assign to a zone/ })).toBeNull()
  })

  it('keeps the rows of the cluster that answered and says on one line that the other cannot be read', async () => {
    driftsSetup([{ kind: 'unzoned_running', guest: g(100) }], 502)
    renderTab(<DriftsPanel connectionId='c1' policy={policy()} {...handlers()} {...shared} />)
    await waitFor(() => expect(driftRows()).toHaveLength(1))
    const unread = await screen.findByTestId('cluster-unread')
    expect(within(unread).getByText('PVE-DR')).toBeTruthy()
    expect(within(unread).getByText('Cannot be read: its rows are not listed.')).toBeTruthy()
  })

  it('shows no cluster chip on a policy of one cluster', async () => {
    driftsSetup([{ kind: 'unzoned_running', guest: g(100) }], [])
    renderTab(<DriftsPanel connectionId='c1' policy={policy()} {...handlers()} />)
    await waitFor(() => expect(driftRows()).toHaveLength(1))
    expect(screen.queryByText('PVE-PROD')).toBeNull()
    expect(calls(`GET ${C2}/drifts`)).toHaveLength(0)
  })
})

describe('zones of a shared policy when a cluster cannot be listed', () => {
  // The inventory of an unreachable cluster answers 200 with no guest and `partial` (its list read failed).
  function zonesSetup() {
    window.localStorage.setItem('microseg.subTab', 'policy')
    window.localStorage.setItem('microseg.policy.openCards.c1', JSON.stringify(['zd']))
    mock.routes['GET /clusters'] = () => reply(200, { clusters: [link('c1'), link('c2')], max: 8 })
    mock.routes['GET /policy'] = () => reply(200, policy({ zones: [zone('zd', { name: 'db' })], last_revision: REVISION_HEAD, clusters: [link('c1'), link('c2')] }))
    mock.routes[`GET ${GUESTS_ROUTE}`] = () => reply(200, { data: { vms: [vm(100, 'db-prod', ['zone-db'])] } })
    mock.routes['GET /api/v1/vms?connId=c2'] = () => reply(200, { data: { vms: [], partial: true } })
    mock.routes[`GET ${C2}/status`] = () => reply(200, status())
    return renderTab(<MicrosegTab connectionId='c1' connections={CONNECTIONS} />)
  }

  it('says on one line above the zones, on the zone card and in the zone panel that the guests of that cluster are missing', async () => {
    zonesSetup()
    expect(await screen.findByText('The guests of PVE-DR could not be read: they are not listed.')).toBeTruthy()
    const card = await screen.findByRole('listitem', { name: 'db' })
    expect(within(card).getByText('The guests of PVE-DR could not be read: they are not counted.')).toBeTruthy()
    const details = await screen.findByRole('region', { name: 'Details of db' })
    expect(await within(details).findByRole('listitem', { name: 'db-prod' })).toBeTruthy()
    expect(within(details).getByText('The guests of PVE-DR could not be read: they are not counted.')).toBeTruthy()
  })
})

describe('uncovered traffic of a shared policy', () => {
  const bucket = (zoneName: string, hits: number) => ({ at: '2026-11-03T09:00:00Z', zone: zoneName, src_zone: '', verdict: 'would_block', hits })
  const traffic = (buckets: ReturnType<typeof bucket>[]) => reply(200, { step: 3600, from: '', to: '', buckets })

  it('sums what each cluster logged into a zone, one history read per cluster, in the Policy table and the Observation banner', async () => {
    window.localStorage.setItem('microseg.subTab', 'policy')
    mock.routes['GET /clusters'] = () => reply(200, { clusters: [link('c1'), link('c2')], max: 8 })
    mock.routes['GET /policy'] = () => reply(200, policy({ zones: [zone('zd', { name: 'db' }), zone('zw', { name: 'web' })], last_revision: REVISION_HEAD, clusters: [link('c1'), link('c2')] }))
    mock.routes['GET /api/v1/vms?connId=c2'] = () => reply(200, { data: { vms: [] } })
    mock.routes[`GET ${C2}/status`] = () => reply(200, status())
    mock.routes['GET /traffic*'] = () => traffic([bucket('db', 2554)])
    mock.routes[`GET ${C2}/traffic*`] = () => traffic([bucket('db', 737), bucket('web', 107)])
    mock.routes['GET /suggestions*'] = () => reply(200, { suggestions: [], limit: 26, offset: 0 })
    renderTab(<MicrosegTab connectionId='c1' connections={CONNECTIONS} />)
    const t = await screen.findByRole('table', { name: 'Flows' })
    const db = await within(within(t).getByRole('rowgroup', { name: 'db' })).findByRole('button', { name: 'Uncovered 24 h: 3,291 hits' })
    expect(within(within(t).getByRole('rowgroup', { name: 'web' })).getByRole('button', { name: 'Uncovered 24 h: 107 hits' })).toBeTruthy()
    const reads = fetchedUrls().filter(u => /\/traffic\?/.test(u))
    expect(reads.some(u => u.includes('/microseg/c1/traffic?'))).toBe(true)
    expect(reads.some(u => u.startsWith(`${C2}/traffic?`))).toBe(true)

    fireEvent.click(db)
    expect(await screen.findByText('Suggestions for zone db · 3,291 uncovered hits in 24 h')).toBeTruthy()
  })

  it('keeps the count of the clusters that answer when one history cannot be read', async () => {
    window.localStorage.setItem('microseg.subTab', 'policy')
    mock.routes['GET /clusters'] = () => reply(200, { clusters: [link('c1'), link('c2')], max: 8 })
    mock.routes['GET /policy'] = () => reply(200, policy({ zones: [zone('zd', { name: 'db' })], last_revision: REVISION_HEAD, clusters: [link('c1'), link('c2')] }))
    mock.routes['GET /api/v1/vms?connId=c2'] = () => reply(200, { data: { vms: [] } })
    mock.routes[`GET ${C2}/status`] = () => reply(200, status())
    mock.routes['GET /traffic*'] = () => traffic([bucket('db', 4)])
    mock.routes[`GET ${C2}/traffic*`] = () => reply(503, { code: 'ORCHESTRATOR_UNREACHABLE', error: 'down' })
    renderTab(<MicrosegTab connectionId='c1' connections={CONNECTIONS} />)
    const t = await screen.findByRole('table', { name: 'Flows' })
    expect(await within(within(t).getByRole('rowgroup', { name: 'db' })).findByRole('button', { name: 'Uncovered 24 h: 4 hits' })).toBeTruthy()
  })
})

describe('ignored drifts of a shared policy', () => {
  const same: MicrosegDrift = { kind: 'unzoned_running', guest: g(100) }
  const stored = (conn: string) => JSON.parse(window.localStorage.getItem(`microseg.ignoredDrifts.${conn}`) ?? '[]') as string[]

  it('ignores the row of one cluster only, stored under that cluster with the plain key', async () => {
    driftsSetup([same], [same])
    renderTab(<DriftsPanel connectionId='c1' policy={policy()} {...handlers()} {...shared} />)
    await waitFor(() => expect(driftRows()).toHaveLength(2))
    fireEvent.click(within(driftRows()[1]).getByRole('button', { name: 'Ignore' }))
    await waitFor(() => expect(driftRows()).toHaveLength(1))
    expect(within(driftRows()[0]).getByText('PVE-PROD')).toBeTruthy()
    expect(stored('c2')).toEqual([driftKey(same)])
    expect(stored('c1')).toEqual([])
  })

  it.each(['c1', 'c2'])('keeps hiding what was ignored before the policy was shared, entering through %s', async entry => {
    window.localStorage.setItem('microseg.ignoredDrifts.c1', JSON.stringify([driftKey(same)]))
    driftsSetup([same], [same])
    if (entry === 'c2') {
      mock.routes[`GET ${C2}/drifts`] = () => reply(200, { drifts: [same], computed: true })
      mock.routes['GET /drifts'] = () => reply(200, { drifts: [same], computed: true })
    }
    renderTab(<DriftsPanel connectionId={entry} policy={policy()} {...handlers()} {...shared} />)
    await waitFor(() => expect(driftRows()).toHaveLength(1))
    expect(within(driftRows()[0]).getByText('PVE-DR')).toBeTruthy()
  })
})

describe('history of a shared policy', () => {
  const run = (id: string, connection_id: string, over: Partial<MicrosegRun> = {}): MicrosegRun => ({
    id, policy_id: 'p1', connection_id, kind: 'apply', status: 'done', started_at: '2026-11-02T09:29:50Z', duration_ms: 20_000, api_calls: 3, writes: 2, error: '', ...over,
  })
  const revision: MicrosegRevision = { id: 'rev-9', version: 9, author: 'ana', created_at: '2026-11-02T09:30:00Z', snapshot: { tag_prefix: 'zone-', zones: [], flows: [] } }

  it('puts the application runs of both clusters under the one revision, and says when another cluster started a pass', async () => {
    mock.routes['GET /revisions?limit=100'] = () => reply(200, { revisions: [revision] })
    // GET /runs names the revision each application recorded.
    mock.routes['GET /runs?limit=100'] = () => reply(200, { runs: [run('a1', 'c1', { revision_id: 'rev-9' })], limit: 100, offset: 0 })
    mock.routes[`GET ${C2}/runs?limit=100`] = () => reply(200, {
      runs: [run('a2', 'c2', { revision_id: 'rev-9' }), run('p2', 'c2', { kind: 'full', started_at: '2026-11-02T10:00:00Z', result: { guests: 1, members: 1, steps: 0, drifts: 0, trigger: 'peer' } })],
      limit: 100, offset: 0,
    })
    const current = policy({ last_revision: { id: 'rev-9', version: 9, author: 'ana', created_at: revision.created_at } })
    renderTab(<HistoryPanel connectionId='c1' policy={current} {...handlers()} {...shared} />)

    const head = await screen.findByRole('row', { name: 'Version 9' })
    // The applications are not on rows of their own: only the revision and the pass another cluster asked for.
    await waitFor(() => expect(document.querySelectorAll('tr[data-row="run"]')).toHaveLength(1))
    const peer = document.querySelector('tr[data-row="run"]') as HTMLElement
    expect(within(peer).getByText('Another cluster changed')).toBeTruthy()
    expect(within(peer).getByText('PVE-DR')).toBeTruthy()

    fireEvent.click(within(head).getByRole('button', { name: 'Show the run of each cluster' }))
    const list = await screen.findByRole('list', { name: 'The run of each cluster' })
    expect(within(list).getAllByRole('listitem').map(l => l.getAttribute('aria-label'))).toEqual(['PVE-PROD', 'PVE-DR'])
  })
})

describe('observed flows of a shared policy', () => {
  const route = 'GET /suggestions*'

  it('reads every cluster in one call, shows the cluster of each flow and filters by cluster on the server', async () => {
    mock.routes[route] = () => reply(200, { suggestions: [{ ...suggestion('2026-11-03T10:00:00Z'), id: 's2', connection_id: 'c2' }], limit: 26, offset: 0 })
    renderTab(<ObservationPanel connectionId='c1' policy={policy({ zones: [zone('a')] })} {...handlers()} {...shared} />)
    const row = await waitFor(() => {
      const found = document.querySelector('tr[data-suggestion="s2"]')
      expect(found).toBeTruthy()
      return found as HTMLElement
    })
    expect(within(row).getByText('PVE-DR')).toBeTruthy()
    expect(calls(`GET ${C2}/suggestions`)).toHaveLength(0)

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Cluster' }))
    fireEvent.click(await screen.findByRole('option', { name: 'PVE-DR' }))
    await waitFor(() => expect(fetchedUrls().some(u => u.includes('/suggestions') && u.includes('connection=c2'))).toBe(true))
  })

  it('opens on the cluster the Dashboard was on', async () => {
    mock.routes[route] = () => reply(200, { suggestions: [], limit: 26, offset: 0 })
    renderTab(<ObservationPanel connectionId='c1' policy={policy({ zones: [zone('a')] })} {...handlers()} {...shared} observationFocus={{ cluster: 'c1' }} />)
    await waitFor(() => expect(fetchedUrls().some(u => u.includes('/suggestions') && u.includes('connection=c1'))).toBe(true))
    expect(fetchedUrls().some(u => u.includes('/suggestions') && !u.includes('connection='))).toBe(false)
  })

  it('offers no cluster filter and no chip on a policy of one cluster', async () => {
    mock.routes[route] = () => reply(200, { suggestions: [{ ...suggestion('2026-11-03T10:00:00Z'), id: 's1', connection_id: 'c1' }], limit: 26, offset: 0 })
    renderTab(<ObservationPanel connectionId='c1' policy={policy({ zones: [zone('a')] })} {...handlers()} />)
    await waitFor(() => expect(document.querySelector('tr[data-suggestion="s1"]')).toBeTruthy())
    expect(screen.queryByRole('combobox', { name: 'Cluster' })).toBeNull()
    expect(fetchedUrls().some(u => u.includes('connection='))).toBe(false)
  })
})

describe('banner of a shared policy', () => {
  it('tells the cluster firewall of each cluster, and a cluster whose status fails on its own line without hiding the other', async () => {
    mock.routes['GET /clusters'] = () => reply(200, { clusters: [link('c1'), link('c2')], max: 8 })
    mock.routes['GET /status'] = () => reply(200, status({ emergency_stop: true, engine: { paused_until: null, held: false, last_runs: {}, last_log: null, cluster_firewall: 'disabled' } }))
    mock.routes[`GET ${C2}/status`] = () => reply(504, { code: 'ORCHESTRATOR_TIMEOUT', error: 't' })
    mock.routes['GET /policy'] = () => reply(200, policy({ zones: [zone('a')], last_revision: REVISION_HEAD, clusters: [link('c1'), link('c2')] }))
    renderTab(<MicrosegTab connectionId='c1' connections={CONNECTIONS} />)

    expect(await screen.findByText('Cluster firewall off: PVE-PROD')).toBeTruthy()
    const unread = await screen.findByTestId('cluster-unread')
    expect(within(unread).getByText('PVE-DR')).toBeTruthy()
    expect(within(unread).getByText('Unreachable: its state is unknown.')).toBeTruthy()
    expect(screen.getByText('Emergency stop active: every zone is in observation')).toBeTruthy()
  })
})

describe('a cluster of a shared policy that cannot be reached', () => {
  const since = (iso: string) => status({ engine: { paused_until: null, held: false, last_runs: {}, last_log: null, unreachable_since: iso } })
  const LINE = /^Cluster PVE-DR has been unreachable since .*2026.*: its rules are not updated, the other clusters keep its last known addresses\.$/

  it('says so on one line of the banner from the status already read, and nothing for a cluster outside the user scope', async () => {
    mock.routes['GET /clusters'] = () => reply(200, { clusters: [link('c1'), link('c2'), link('c3')], max: 8 })
    mock.routes['GET /policy'] = () => reply(200, policy({ zones: [zone('a')], last_revision: REVISION_HEAD, clusters: [link('c1'), link('c2'), link('c3')] }))
    mock.routes[`GET ${C2}/status`] = () => reply(200, since('2026-11-17T07:58:00Z'))
    mock.routes['GET /api/v1/firewall/microseg/c3/status'] = () => reply(200, since('2026-11-17T07:58:00Z'))
    renderTab(<MicrosegTab connectionId='c1' connections={CONNECTIONS} />)
    expect(await screen.findByText(LINE)).toBeTruthy()
    expect(screen.getAllByText(/has been unreachable since/)).toHaveLength(1)
    expect(calls('GET /api/v1/firewall/microseg/c3/status')).toHaveLength(0)
  })

  it('says no such line while every cluster is reachable', async () => {
    mock.routes['GET /clusters'] = () => reply(200, { clusters: [link('c1'), link('c2')], max: 8 })
    mock.routes['GET /policy'] = () => reply(200, policy({ zones: [zone('a')], last_revision: REVISION_HEAD, clusters: [link('c1'), link('c2')] }))
    mock.routes[`GET ${C2}/status`] = () => reply(200, status())
    renderTab(<MicrosegTab connectionId='c1' connections={CONNECTIONS} />)
    await waitFor(() => expect(calls(`GET ${C2}/status`).length).toBeGreaterThan(0))
    expect(screen.queryByText(/has been unreachable since/)).toBeNull()
  })

  it('tells the zones that the guests of that cluster are missing, from its status, without reading it again', async () => {
    window.localStorage.setItem('microseg.subTab', 'policy')
    mock.routes['GET /clusters'] = () => reply(200, { clusters: [link('c1'), link('c2')], max: 8 })
    mock.routes['GET /policy'] = () => reply(200, policy({ zones: [zone('zd', { name: 'db' })], last_revision: REVISION_HEAD, clusters: [link('c1'), link('c2')] }))
    mock.routes[`GET ${GUESTS_ROUTE}`] = () => reply(200, { data: { vms: [vm(100, 'db-prod', ['zone-db'])] } })
    // No `partial` flag: the status alone says the cluster cannot be reached.
    mock.routes['GET /api/v1/vms?connId=c2'] = () => reply(200, { data: { vms: [] } })
    mock.routes[`GET ${C2}/status`] = () => reply(200, since('2026-11-17T07:58:00Z'))
    renderTab(<MicrosegTab connectionId='c1' connections={CONNECTIONS} />)
    expect(await screen.findByText('The guests of PVE-DR could not be read: they are not listed.')).toBeTruthy()
    const card = await screen.findByRole('listitem', { name: 'db' })
    expect(within(card).getByText('The guests of PVE-DR could not be read: they are not counted.')).toBeTruthy()
    // One status read per cluster, as the banner makes it: the zones add none.
    expect(calls(`GET ${C2}/status`)).toHaveLength(1)
  })
})

describe('clusters the user cannot see', () => {
  it('reads no status of a cluster outside the user scope, and tells a refused read from an unreachable one', async () => {
    mock.routes['GET /clusters'] = () => reply(200, { clusters: [link('c1'), link('c2'), link('c3')], max: 8 })
    mock.routes[`GET ${C2}/status`] = () => reply(403, { code: 'FORBIDDEN', error: 'no' })
    mock.routes['GET /api/v1/firewall/microseg/c3/status'] = () => reply(504, { code: 'ORCHESTRATOR_TIMEOUT', error: 't' })
    renderTab(<MicrosegTab connectionId='c1' connections={CONNECTIONS} />)
    const unread = await screen.findByTestId('cluster-unread')
    expect(within(unread).getByText('PVE-DR')).toBeTruthy()
    expect(within(unread).getByText('Cannot be read: its state is not shown.')).toBeTruthy()
    expect(within(unread).getAllByRole('listitem')).toHaveLength(1)
    expect(calls('GET /api/v1/firewall/microseg/c3/status')).toHaveLength(0)
  })
})

describe('preflight of a shared policy', () => {
  it('reads nothing before the group is known, then each cluster once', async () => {
    mock.routes['GET /preflight'] = () => reply(200, { checks: [{ id: 'cluster_firewall', status: 'pass' }] })
    mock.routes[`GET ${C2}/preflight`] = () => reply(200, { checks: [{ id: 'cluster_firewall', status: 'pass' }] })
    const view = renderTab(<PreflightPanel open connectionId='c2' onClose={vi.fn()} clusterIds={['c2']} clusterName={clusterName} />)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(calls(`GET ${C2}/preflight`)).toHaveLength(0)
    view.rerender(<PreflightPanel open connectionId='c2' onClose={vi.fn()} anchor='c1' clusterIds={['c1', 'c2']} clusterName={clusterName} />)
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(calls('GET /preflight')).toHaveLength(1)
    expect(calls(`GET ${C2}/preflight`)).toHaveLength(1)
  })
})

describe('check now on a shared policy', () => {
  it('queues a check on every active cluster, never on one not applied yet, and follows them as one group run', async () => {
    mock.routes['GET /clusters'] = () => reply(200, { clusters: [link('c1'), link('c2'), link('c3', false), link('c4')], max: 8 })
    const full = (id: string, connection_id: string): MicrosegRun => ({
      id, policy_id: 'p1', connection_id, kind: 'full', status: 'done', started_at: '2099-01-01T00:00:00Z', duration_ms: 1000, api_calls: 4, writes: 0, error: '',
      result: { guests: 2, members: 1, steps: 0, drifts: 0, trigger: 'check' },
    })
    for (const [base, id] of [['', 'f1'], [C2, 'f2']] as const) {
      const conn = id === 'f1' ? 'c1' : 'c2'
      mock.routes[`POST ${base}/check`] = () => reply(202, { queued: true, requested_at: '2026-11-03T10:00:00Z' })
      mock.routes[`GET ${base}/status`] = () => reply(200, status())
      mock.routes[`GET ${base}/runs?limit=10`] = () => reply(200, { runs: [full(id, conn)], limit: 10, offset: 0 })
      mock.routes[`GET ${base}/runs/${id}`] = () => reply(200, full(id, conn))
    }
    renderTab(<MicrosegTab connectionId='c1' connections={[...CONNECTIONS, { id: 'c3', name: 'PVE-NEW' }]} />)
    await waitFor(() => expect(calls('GET /clusters').length).toBeGreaterThan(0))
    const button = await screen.findByRole('button', { name: 'Check now' })
    fireEvent.click(button)
    const dialog = await screen.findByRole('dialog', { name: 'Full check' })

    await waitFor(() => expect(calls('POST /check')).toHaveLength(1))
    expect(calls(`POST ${C2}/check`)).toHaveLength(1)
    expect(calls('POST /api/v1/firewall/microseg/c3/check')).toHaveLength(0)
    // c4 is active but outside the user's scope: neither asked nor listed.
    expect(calls('POST /api/v1/firewall/microseg/c4/check')).toHaveLength(0)
    expect(await within(dialog).findByText('Checked on 2 of 2 clusters')).toBeTruthy()
    const lines = within(dialog).getByRole('list', { name: 'Clusters checked' })
    expect(within(lines).getAllByRole('listitem').map(l => l.getAttribute('aria-label'))).toEqual(['PVE-PROD', 'PVE-DR'])
  })
})

describe('check now while a cluster status cannot be read', () => {
  it('says the failed status read on that cluster line while its check waits', async () => {
    mock.routes['GET /clusters'] = () => reply(200, { clusters: [link('c1'), link('c2')], max: 8 })
    // c1 has its check queued once asked; c2's status cannot be read meanwhile.
    let pending = false
    mock.routes['POST /check'] = () => { pending = true; return reply(202, { queued: true, requested_at: '2026-11-03T10:00:00Z' }) }
    mock.routes[`POST ${C2}/check`] = () => reply(202, { queued: true, requested_at: '2026-11-03T10:00:00Z' })
    mock.routes['GET /status'] = () => reply(200, status({ engine: { paused_until: null, held: false, check_pending: pending, last_runs: {}, last_log: null } }))
    mock.routes[`GET ${C2}/status`] = () => reply(504, { code: 'ORCHESTRATOR_TIMEOUT', error: 't' })
    renderTab(<MicrosegTab connectionId='c1' connections={CONNECTIONS} />)
    await waitFor(() => expect(calls('GET /clusters').length).toBeGreaterThan(0))
    fireEvent.click(await screen.findByRole('button', { name: 'Check now' }))
    const dialog = await screen.findByRole('dialog', { name: 'Full check' })
    const line = await within(dialog).findByRole('listitem', { name: 'PVE-DR' })
    await waitFor(() => expect(line.textContent).toContain('The orchestrator did not answer in time.'))
    expect(within(dialog).getByRole('listitem', { name: 'PVE-PROD' }).textContent).toContain('Waiting for the engine')
  })
})

describe('events of a shared policy', () => {
  const ev = (seq: number, ts: string) => ({ seq, ts, node: 'pve1', vmid: 100, type: 'qemu' as const, guest: 'web', zone: 'web', src_zone: '', src_ip: '10.0.0.1', dst_ip: '10.0.0.2', proto: 'tcp', dport: 22, verdict: 'blocked' as const })

  it('merges the clusters newest first and stops at the oldest event a cluster with older pages has read', () => {
    const merged = mergeClusterEvents({
      c1: { events: [ev(5, '2026-11-03T10:05:00Z'), ev(4, '2026-11-03T10:03:00Z')], more: true },
      c2: { events: [ev(9, '2026-11-03T10:04:00Z'), ev(8, '2026-11-03T10:01:00Z')], more: false },
    }, ['c1', 'c2'])
    expect(merged.events.map(e => `${e.connection_id}:${e.seq}`)).toEqual(['c1:5', 'c2:9', 'c1:4'])
    expect(merged.more).toBe(true)
  })
})
