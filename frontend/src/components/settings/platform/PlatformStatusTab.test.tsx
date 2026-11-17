import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, within } from '@testing-library/react'
import { SWRConfig } from 'swr'

import { renderWithProviders, screen, waitFor, fireEvent } from '@/__tests__/setup/renderWithProviders'
import type { OrchestratorStatus, OrchestratorTask, PlatformStatus } from '@/lib/platform/types'

import PlatformStatusTab from './PlatformStatusTab'

const NOW = '2026-11-17T08:00:00.000Z'

const task = (over: Partial<OrchestratorTask>): OrchestratorTask => ({
  name: 'task',
  schedule: '@every 1h0m0s',
  exclusive: false,
  running: false,
  runs: 0,
  failures: 0,
  last_duration_ms: 0,
  ...over
})

const orchestrator = (over: Partial<OrchestratorStatus> = {}): OrchestratorStatus => ({
  version: '1.5.0',
  hostname: 'orch-1',
  started_at: '2026-11-17T07:00:00.000Z',
  uptime_seconds: 3600,
  leader: true,
  runtime: { go_version: 'go1.27.3', goroutines: 33, heap_alloc_bytes: 6 * 1024 * 1024, sys_bytes: 24 * 1024 * 1024, gc_count: 11 },
  disks: [],
  db_pool: { max_open: 10, open: 2, in_use: 1, idle: 1, wait_count: 0, wait_duration_ms: 0 },
  renderer: { configured: true, healthy: true, latency_ms: 3 },
  tasks: [
    task({ name: 'metrics', schedule: '@every 1m0s', runs: 4, last_run: '2026-11-17T07:59:00.000Z', last_duration_ms: 2040 }),
    task({
      name: 'ceph-metrics',
      runs: 3,
      failures: 2,
      last_run: '2026-11-17T07:58:00.000Z',
      last_duration_ms: 417,
      last_error: 'cluster unreachable',
      last_error_at: '2026-11-17T07:58:00.000Z'
    }),
    task({ name: 'notifications-retention' })
  ],
  retention: { notifications: 30, task_history: 90, brand_new_set: 5 },
  ...over
})

const status = (over: Partial<PlatformStatus> = {}): PlatformStatus => ({
  generatedAt: NOW,
  edition: 'enterprise',
  overall: 'up',
  services: [
    { id: 'frontend', state: 'up', version: '1.5.0', uptimeSeconds: 7200, cpuPercent: 12.34, memoryBytes: 256 * 1024 * 1024, memoryLimitBytes: 1024 * 1024 * 1024, reason: null },
    { id: 'database', state: 'up', version: '16.15', uptimeSeconds: 90000, cpuPercent: null, memoryBytes: null, memoryLimitBytes: null, reason: null },
    { id: 'orchestrator', state: 'degraded', version: '1.5.0', uptimeSeconds: 3600, cpuPercent: null, memoryBytes: 40 * 1024 * 1024, memoryLimitBytes: null, reason: 'tasksFailing' },
    { id: 'renderer', state: 'down', version: null, uptimeSeconds: null, cpuPercent: null, memoryBytes: null, memoryLimitBytes: null, reason: 'unreachable' }
  ],
  frontend: { version: '1.5.0', gitSha: '', nodeVersion: 'v26.12.1', hostname: 'pxc-1', uptimeSeconds: 7200, rssBytes: 300 * 1024 * 1024, heapUsedBytes: 100 * 1024 * 1024, eventLoopDelayMs: 22 },
  container: null,
  host: { load1: 1.5, load5: 3.2, load15: 4, cpus: 4, memTotalBytes: 16 * 1024 ** 3, memAvailableBytes: 2 * 1024 ** 3, uptimeSeconds: 172800 },
  disks: [{ label: 'data', path: '/app/data', totalBytes: 100 * 1024 ** 3, freeBytes: 5 * 1024 ** 3 }],
  database: {
    version: '16.15',
    startedAt: '2026-11-16T07:00:00.000Z',
    sizeBytes: 80 * 1024 * 1024,
    connections: 16,
    activeConnections: 1,
    maxConnections: 100,
    cacheHitPercent: 99.56,
    deadlocks: 0,
    inRecovery: false,
    tables: [
      { name: 'notifications', totalBytes: 25 * 1024 * 1024, rows: 36793, deadRows: 1, lastVacuum: '2026-11-17T07:43:00.000Z' },
      { name: 'never_analysed', totalBytes: 8192, rows: null, deadRows: 0, lastVacuum: null }
    ]
  },
  orchestrator: orchestrator(),
  ha: null,
  ...over
})

const json = (body: unknown, code = 200) => new Response(JSON.stringify(body), { status: code })

const EMPTY_HISTORY = { range: '1h', from: 0, to: 1, intervalSeconds: 30, cpus: 4, memTotalBytes: 0, samples: [] }

function mockStatus(answer: () => Response | Promise<Response>) {
  const fn = vi.fn(async (url: string) => (String(url).includes('/status/history') ? json(EMPTY_HISTORY) : answer()))

  vi.stubGlobal('fetch', fn)

  return fn
}

// A fresh SWR cache per test: the tab polls one URL, and a cached answer from
// the previous test would hide the one this test serves.
const renderTab = () =>
  renderWithProviders(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnMount: true }}>
      <PlatformStatusTab />
    </SWRConfig>
  )

const rowOf = (text: string) => screen.getByText(text).closest('div[class*="MuiBox-root"]')!.parentElement!

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('PlatformStatusTab', () => {
  it('shows the services of the installation with their state', async () => {
    mockStatus(() => json(status({ overall: 'degraded' })))
    renderTab()

    expect(await screen.findByText('Degraded', { selector: '.MuiChip-label' })).toBeInTheDocument()
    expect(screen.getByText(/ProxCenter 1\.5\.0 on pxc-1, updated at/)).toBeInTheDocument()

    const db = within(rowOf('PostgreSQL database'))

    expect(db.getByText('16.15')).toBeInTheDocument()
    expect(db.getByText('1d 1h')).toBeInTheDocument()
    expect(db.getByText('Running')).toBeInTheDocument()

    const web = within(screen.getAllByText('Web interface')[0].closest('div[class*="MuiBox-root"]')!.parentElement!)

    expect(web.getByText('12.3 %')).toBeInTheDocument()
    expect(web.getByText('256 MiB / 1 GiB')).toBeInTheDocument()

    const orch = screen.getByText('Orchestrator', { selector: 'p' }).closest('div[class*="MuiBox-root"]')!.parentElement!

    expect(within(orch).getByText('Scheduled tasks failing')).toBeInTheDocument()
    expect(within(rowOf('PDF report renderer')).getByText('Unreachable')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Down' })).toBeInTheDocument()
  })

  it('shows the host figures now, its history as charts and the disks as meters', async () => {
    const fetchMock = mockStatus(() => json(status()))

    renderTab()

    expect(await screen.findByText('Load average (1, 5, 15 min)')).toBeInTheDocument()
    expect(screen.getByText('1.50 / 3.20 / 4.00')).toBeInTheDocument()
    expect(screen.getByText('14 GiB / 16 GiB')).toBeInTheDocument()
    expect(screen.getByText('95 GiB / 100 GiB')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Application data disk' })).toHaveAttribute('aria-valuenow', '95')
    expect(screen.getByText('2d 0h')).toBeInTheDocument()

    // The charts load their own history, over the last hour by default.
    expect(screen.getByRole('group', { name: 'Period' })).toBeInTheDocument()
    await waitFor(() => expect(fetchMock.mock.calls.map(([url]: any) => String(url))).toContain('/api/v1/system/status/history?range=1h'))

    // The web interface's own figures.
    expect(screen.getByText('22 ms')).toBeInTheDocument()
    expect(screen.getByText('v26.12.1')).toBeInTheDocument()
  })

  it('lists the retention in force, an unknown data set by its key', async () => {
    mockStatus(() => json(status()))
    renderTab()

    expect(within(rowOf(await screen.findByText('Notification history').then(e => e.textContent!))).getByText('30 days')).toBeInTheDocument()
    expect(within(rowOf('Proxmox task history')).getByText('90 days')).toBeInTheDocument()
    expect(within(rowOf('brand_new_set')).getByText('5 days')).toBeInTheDocument()
  })

  it('says so when the platform exposes no host figures', async () => {
    mockStatus(() => json(status({ host: null, disks: [] })))
    renderTab()

    expect(await screen.findByText('This platform does not expose host figures.')).toBeInTheDocument()
  })

  it('shows the database and its tables on the Database view', async () => {
    mockStatus(() => json(status()))
    renderTab()

    fireEvent.click(await screen.findByRole('tab', { name: 'Database' }))

    expect(screen.getByText('80 MiB')).toBeInTheDocument()
    expect(screen.getByText('16 / 100')).toBeInTheDocument()
    expect(screen.getByText('99.6 %')).toBeInTheDocument()
    expect(screen.getByText('Primary')).toBeInTheDocument()

    const notifications = within(rowOf('notifications'))

    expect(notifications.getByText('36,793')).toBeInTheDocument()
    expect(notifications.getByText('25 MiB')).toBeInTheDocument()
    expect(notifications.getByText('17 minutes ago')).toBeInTheDocument()

    const fresh = within(rowOf('never_analysed'))

    expect(fresh.getByText('-')).toBeInTheDocument()
    expect(fresh.getByText('Never')).toBeInTheDocument()
    expect(screen.queryByText('Services')).not.toBeInTheDocument()
  })

  it('reports an unreachable database and a replica', async () => {
    mockStatus(() => json(status({ database: null })))
    renderTab()

    fireEvent.click(await screen.findByRole('tab', { name: 'Database' }))
    expect(screen.getByText('The database does not answer.')).toBeInTheDocument()
    cleanup()

    mockStatus(() => json(status({ database: { ...status().database!, inRecovery: true, cacheHitPercent: null } })))
    renderTab()
    fireEvent.click(await screen.findByRole('tab', { name: 'Database' }))
    expect(screen.getByText('Replica')).toBeInTheDocument()
  })

  it('lists the scheduled tasks, failing first, with the error behind a chevron', async () => {
    mockStatus(() => json(status()))
    renderTab()

    fireEvent.click(await screen.findByRole('tab', { name: 'Orchestrator' }))

    expect(screen.getByText('orch-1')).toBeInTheDocument()
    expect(screen.getByText('Leader')).toBeInTheDocument()
    expect(screen.getByText('1 / 10')).toBeInTheDocument()

    const names = screen.getAllByText(/^(metrics|ceph-metrics|notifications-retention)$/).map(e => e.textContent)

    expect(names).toEqual(['ceph-metrics', 'metrics', 'notifications-retention'])

    const failing = within(rowOf('ceph-metrics'))

    expect(failing.getByText('1h')).toBeInTheDocument()
    expect(failing.getByText('417 ms')).toBeInTheDocument()
    expect(failing.getByText('2 / 3')).toBeInTheDocument()
    expect(failing.getByText('Failing')).toBeInTheDocument()

    const ok = within(rowOf('metrics'))

    expect(ok.getByText('1m')).toBeInTheDocument()
    expect(ok.getByText('1 minute ago')).toBeInTheDocument()
    expect(ok.getByText('2.0 s')).toBeInTheDocument()
    expect(ok.getByText('OK')).toBeInTheDocument()

    const idle = within(rowOf('notifications-retention'))

    expect(idle.getByText('Never')).toBeInTheDocument()
    expect(idle.getByText('Waiting')).toBeInTheDocument()

    // Only the failing task carries a chevron; it unfolds the error.
    const chevrons = screen.getAllByRole('button', { name: 'Show the last error' })

    expect(chevrons).toHaveLength(1)
    expect(screen.queryByText('cluster unreachable')).not.toBeInTheDocument()
    fireEvent.click(chevrons[0])
    expect(screen.getByText('cluster unreachable')).toBeInTheDocument()
    fireEvent.click(chevrons[0])
    expect(screen.queryByText('cluster unreachable')).not.toBeInTheDocument()
  })

  it('reports an unreachable orchestrator, a follower and a running task', async () => {
    mockStatus(() => json(status({ orchestrator: null })))
    renderTab()

    fireEvent.click(await screen.findByRole('tab', { name: 'Orchestrator' }))
    expect(screen.getByText('The orchestrator does not answer.')).toBeInTheDocument()
    cleanup()

    const follower = orchestrator({ leader: false, db_pool: undefined, tasks: [task({ name: 'drs', running: true, runs: 1 })] })

    mockStatus(() => json(status({ orchestrator: follower })))
    renderTab()
    fireEvent.click(await screen.findByRole('tab', { name: 'Orchestrator' }))
    expect(screen.getByText('Follower')).toBeInTheDocument()
    expect(within(rowOf('drs')).getByText('Running')).toBeInTheDocument()
    expect(screen.queryByText('SQL connections')).not.toBeInTheDocument()
  })

  it('has no Orchestrator view nor retention list on Community', async () => {
    mockStatus(() => json(status({ edition: 'community', orchestrator: null, services: status().services.slice(0, 2) })))
    renderTab()

    expect(await screen.findByRole('tab', { name: 'Overview' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Orchestrator' })).not.toBeInTheDocument()
    expect(screen.queryByText('Data retention')).not.toBeInTheDocument()
    expect(screen.getByText('All services running')).toBeInTheDocument()
  })

  it('lists the cluster nodes first on a high-availability install and names the node that answered', async () => {
    const running = { etcd: 'running', frontend: 'running', haproxy: 'running', keepalived: 'running', orchestrator: 'running', patroni: 'running', weasyprint: 'running' }
    const ha = {
      vip: '10.42.0.40',
      syncMode: 'synchronous_mode_strict',
      paused: false,
      hasLeader: true,
      nodes: [
        { name: 'proxcenter-2', address: '10.42.0.42', state: 'up' as const, dbRole: 'leader', dbState: 'running', lagBytes: 0, version: '1.5.0', holdsVip: true, etcdHealthy: true, services: running, host: null }
      ]
    }

    mockStatus(() => json(status({ ha })))
    renderTab()

    expect(await screen.findByText('Cluster nodes')).toBeInTheDocument()
    expect(screen.getByText('proxcenter-2')).toBeInTheDocument()
    expect(screen.getByText('DB Primary')).toBeInTheDocument()
    // The sections below describe one node only: they say which.
    expect(screen.getByText('Services on pxc-1')).toBeInTheDocument()
    expect(screen.getByText('Host pxc-1')).toBeInTheDocument()
  })

  it('has no cluster section on a single-node install', async () => {
    mockStatus(() => json(status()))
    renderTab()

    expect(await screen.findByText('Services')).toBeInTheDocument()
    expect(screen.queryByText('Cluster nodes')).not.toBeInTheDocument()
    expect(screen.getByText('Host')).toBeInTheDocument()
  })

  it('words a down platform and refreshes on demand', async () => {
    const fetchMock = mockStatus(() => json(status({ overall: 'down' })))

    renderTab()

    expect(await screen.findByText('A service is down')).toBeInTheDocument()
    const statusCalls = () => fetchMock.mock.calls.filter(([url]: any) => String(url) === '/api/v1/system/status').length
    const calls = statusCalls()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(statusCalls()).toBeGreaterThan(calls))
  })

  it('says the status could not be loaded when the route fails', async () => {
    mockStatus(() => json({ error: 'forbidden' }, 403))
    renderTab()

    expect(await screen.findByText('The platform status could not be loaded.')).toBeInTheDocument()
  })
})
