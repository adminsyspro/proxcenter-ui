import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  orchestratorConfigured: vi.fn(),
  orchestratorFetch: vi.fn(),
  readDatabase: vi.fn(),
  readHost: vi.fn(),
  readContainer: vi.fn(),
  diskUsage: vi.fn()
}))

vi.mock('@/lib/auth/communitySuperAdmin', () => ({ isOrchestratorConfigured: () => mocks.orchestratorConfigured() }))
vi.mock('@/lib/orchestrator/client', () => ({ orchestratorFetch: (...a: any[]) => mocks.orchestratorFetch(...a) }))
vi.mock('./database', () => ({ readDatabase: () => mocks.readDatabase() }))
vi.mock('./sysinfo', async importOriginal => ({
  ...(await importOriginal<typeof import('./sysinfo')>()),
  readHost: () => mocks.readHost(),
  readContainer: () => mocks.readContainer(),
  diskUsage: (...a: any[]) => mocks.diskUsage(...a)
}))

import { buildPlatformStatus, overallState, summarizeServices } from './status'
import type { DatabaseInfo, FrontendInfo, OrchestratorStatus, ServiceSummary } from './types'

const frontend: FrontendInfo = {
  version: '1.5.0',
  gitSha: '',
  nodeVersion: 'v26.0.0',
  hostname: 'pxc',
  uptimeSeconds: 120,
  rssBytes: 500,
  heapUsedBytes: 100,
  eventLoopDelayMs: 2
}

const database: DatabaseInfo = {
  version: '16.15',
  startedAt: '2026-11-17T07:00:00.000Z',
  sizeBytes: 1,
  connections: 1,
  activeConnections: 1,
  maxConnections: 100,
  cacheHitPercent: 99,
  deadlocks: 0,
  inRecovery: false,
  tables: []
}

const orchestrator = (over: Partial<OrchestratorStatus> = {}): OrchestratorStatus => ({
  version: '1.5.0',
  hostname: 'orch',
  started_at: '2026-11-17T07:00:00.000Z',
  uptime_seconds: 3600,
  runtime: { go_version: 'go1.27', goroutines: 30, heap_alloc_bytes: 10, sys_bytes: 40, gc_count: 1 },
  container: { memory_bytes: 64, memory_limit_bytes: 128, cpu_limit: 2, cpu_percent: 12.5 },
  disks: [],
  renderer: { configured: true, healthy: true, latency_ms: 3 },
  tasks: [],
  retention: { notifications: 30 },
  ...over
})

const RUNNING = { etcd: 'running', frontend: 'running', haproxy: 'running', keepalived: 'running', orchestrator: 'running', patroni: 'running', weasyprint: 'running' }
const cluster = (services = RUNNING) => ({
  patroni: { syncMode: 'synchronous_mode', paused: false, members: [{ name: 'pxc-1', host: '10.0.0.1', role: 'leader', state: 'running' }, { name: 'pxc-2', host: '10.0.0.2', role: 'replica', state: 'streaming' }] },
  etcd: { members: [{ name: 'pxc-1', healthy: true }, { name: 'pxc-2', healthy: true }] },
  vip: { address: '10.0.0.9', holder: 'pxc-1' },
  services: { 'pxc-1': RUNNING, 'pxc-2': services }
})

/** The orchestrator of a high-availability install: each path answers its own payload. */
const haOrchestrator = (config: unknown, clusterAnswer: unknown) => async (path: string) => {
  if (path === '/ha/config') return config
  if (path === '/ha/cluster') {
    if (clusterAnswer instanceof Error) throw clusterAnswer

    return clusterAnswer
  }

  return orchestrator()
}

const nowMs = Date.parse('2026-11-17T08:00:00.000Z')
const summarize = (over: Partial<Parameters<typeof summarizeServices>[0]> = {}) =>
  summarizeServices({ edition: 'enterprise', frontend, container: null, database, orchestrator: orchestrator(), nowMs, ...over })
const byId = (services: ServiceSummary[], id: ServiceSummary['id']) => services.find(s => s.id === id)!

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.orchestratorConfigured.mockReturnValue(true)
  mocks.orchestratorFetch.mockResolvedValue(orchestrator())
  mocks.readDatabase.mockResolvedValue(database)
  mocks.readHost.mockResolvedValue(null)
  mocks.readContainer.mockResolvedValue(null)
  mocks.diskUsage.mockResolvedValue(null)
})

describe('summarizeServices', () => {
  it('lists the four services of an Enterprise install, all running', () => {
    const services = summarize()

    expect(services.map(s => [s.id, s.state])).toEqual([
      ['frontend', 'up'],
      ['database', 'up'],
      ['orchestrator', 'up'],
      ['renderer', 'up']
    ])
    expect(byId(services, 'database').uptimeSeconds).toBe(3600)
    expect(byId(services, 'orchestrator')).toMatchObject({ cpuPercent: 12.5, memoryBytes: 64, memoryLimitBytes: 128, reason: null })
  })

  it('lists only the frontend and the database on Community', () => {
    expect(summarize({ edition: 'community', orchestrator: null }).map(s => s.id)).toEqual(['frontend', 'database'])
  })

  it('reports the frontend from its container when it has one, from its process otherwise', () => {
    expect(byId(summarize(), 'frontend')).toMatchObject({ memoryBytes: 500, memoryLimitBytes: null, cpuPercent: null })

    const container = { memoryBytes: 800, memoryLimitBytes: 1000, cpuLimit: 1, cpuPercent: 40 }

    expect(byId(summarize({ container }), 'frontend')).toMatchObject({ memoryBytes: 800, memoryLimitBytes: 1000, cpuPercent: 40 })
  })

  it('marks an unreachable database down, with no uptime to show', () => {
    expect(byId(summarize({ database: null }), 'database')).toMatchObject({ state: 'down', reason: 'unreachable', version: null, uptimeSeconds: null })
  })

  it('marks an unreachable orchestrator down and the renderer unknown', () => {
    const services = summarize({ orchestrator: null })

    expect(byId(services, 'orchestrator')).toMatchObject({ state: 'down', reason: 'unreachable', memoryBytes: null })
    expect(byId(services, 'renderer')).toMatchObject({ state: 'unknown', reason: 'orchestratorDown' })
  })

  it('degrades the orchestrator when the last run of a scheduled task failed', () => {
    const tasks = [{ name: 'metrics', schedule: '@every 1m', exclusive: false, running: false, runs: 2, failures: 1, last_duration_ms: 5, last_error: 'boom' }]

    expect(byId(summarize({ orchestrator: orchestrator({ tasks }) }), 'orchestrator')).toMatchObject({ state: 'degraded', reason: 'tasksFailing' })
  })

  it('falls back to the runtime memory of an orchestrator outside a container', () => {
    expect(byId(summarize({ orchestrator: orchestrator({ container: undefined }) }), 'orchestrator')).toMatchObject({ memoryBytes: 40, memoryLimitBytes: null, cpuPercent: null })
  })

  it('tells an unreachable renderer from one that is not configured', () => {
    const down = orchestrator({ renderer: { configured: true, healthy: false, latency_ms: 40, error: 'no such host' } })
    const absent = orchestrator({ renderer: { configured: false, healthy: false, latency_ms: 0 } })

    expect(byId(summarize({ orchestrator: down }), 'renderer')).toMatchObject({ state: 'down', reason: 'unreachable' })
    expect(byId(summarize({ orchestrator: absent }), 'renderer')).toMatchObject({ state: 'unknown', reason: 'notConfigured' })
  })
})

describe('overallState', () => {
  const service = (id: ServiceSummary['id'], state: ServiceSummary['state']) => ({ ...byId(summarize(), id), state })

  it('is up when every service runs, unknown ones aside', () => {
    expect(overallState([service('frontend', 'up'), service('renderer', 'unknown')])).toBe('up')
  })

  it('is degraded, not down, when only the PDF renderer is missing', () => {
    expect(overallState([service('frontend', 'up'), service('renderer', 'down')])).toBe('degraded')
  })

  it('is degraded when a service is', () => {
    expect(overallState([service('frontend', 'up'), service('orchestrator', 'degraded')])).toBe('degraded')
  })

  it('is down when a core service is', () => {
    expect(overallState([service('frontend', 'up'), service('database', 'down'), service('orchestrator', 'degraded')])).toBe('down')
  })
})

describe('buildPlatformStatus', () => {
  it('assembles an Enterprise install and adds the orchestrator data disk', async () => {
    mocks.readHost.mockResolvedValue({ load1: 1, load5: 1, load15: 1, cpus: 4, memTotalBytes: 8, memAvailableBytes: 4, uptimeSeconds: 10 })
    mocks.readContainer.mockResolvedValue({ memoryBytes: 800, memoryLimitBytes: 0, cpuUsageUsec: 1, cpuLimit: 0 })
    mocks.diskUsage.mockResolvedValue({ label: 'data', path: '/app/data', totalBytes: 100, freeBytes: 60 })
    mocks.orchestratorFetch.mockResolvedValue(
      orchestrator({
        disks: [
          { label: 'data', path: '/app/data', total_bytes: 200, free_bytes: 50 },
          { label: 'shared_data', path: '/app/shared_data', total_bytes: 100, free_bytes: 60 }
        ]
      })
    )

    const status = await buildPlatformStatus()

    expect(status.edition).toBe('enterprise')
    expect(status.overall).toBe('up')
    expect(status.host?.cpus).toBe(4)
    expect(status.container).toMatchObject({ memoryBytes: 800, memoryLimitBytes: 0 })
    // The shared volume is this frontend's data directory again: listed once.
    expect(status.disks).toEqual([
      { label: 'data', path: '/app/data', totalBytes: 100, freeBytes: 60 },
      { label: 'orchestrator', path: '/app/data', totalBytes: 200, freeBytes: 50 }
    ])
    expect(status.frontend.version).toBeTruthy()
    expect(mocks.orchestratorFetch).toHaveBeenCalledWith('/system/status', { timeout: 8000 })
    expect(mocks.diskUsage).toHaveBeenCalledWith('data', expect.stringMatching(/data$/))
  })

  it('never asks for an orchestrator on Community', async () => {
    mocks.orchestratorConfigured.mockReturnValue(false)
    const status = await buildPlatformStatus()

    expect(status).toMatchObject({ edition: 'community', orchestrator: null, overall: 'up', disks: [], host: null, container: null })
    expect(status.services.map(s => s.id)).toEqual(['frontend', 'database'])
    expect(mocks.orchestratorFetch).not.toHaveBeenCalled()
  })

  it('still answers when the orchestrator is unreachable, without logging the expected error', async () => {
    mocks.orchestratorFetch.mockRejectedValue(Object.assign(new Error('Orchestrator unavailable'), { code: 'ORCHESTRATOR_UNAVAILABLE' }))
    const status = await buildPlatformStatus()

    expect(status.orchestrator).toBeNull()
    expect(status.overall).toBe('down')
    expect(console.error).not.toHaveBeenCalled()
  })

  it('still answers when the database is the part that broke', async () => {
    mocks.readDatabase.mockRejectedValue(new Error('connection refused'))
    const status = await buildPlatformStatus()

    expect(status.database).toBeNull()
    expect(status.overall).toBe('down')
    expect(console.error).toHaveBeenCalled()
  })
})

describe('buildPlatformStatus on a high-availability install', () => {
  it('lists the nodes once the cluster is converted', async () => {
    mocks.orchestratorFetch.mockImplementation(haOrchestrator({ deploymentState: 'deployed' }, cluster()))
    const status = await buildPlatformStatus()

    expect(status.ha?.nodes.map(n => [n.name, n.state, n.holdsVip])).toEqual([
      ['pxc-1', 'up', true],
      ['pxc-2', 'up', false]
    ])
    expect(status.overall).toBe('up')
    expect(mocks.orchestratorFetch).toHaveBeenCalledWith('/ha/cluster', { timeout: 8000 })
  })

  it('degrades the platform when a node lost a service', async () => {
    mocks.orchestratorFetch.mockImplementation(haOrchestrator({ deploymentState: 'deployed' }, cluster({ ...RUNNING, haproxy: 'stopped' })))
    const status = await buildPlatformStatus()

    expect(status.ha?.nodes[1].state).toBe('degraded')
    expect(status.overall).toBe('degraded')
  })

  it('never probes the nodes of a configuration that is not deployed', async () => {
    mocks.orchestratorFetch.mockImplementation(haOrchestrator({ deploymentState: 'idle', deployedAt: null }, cluster()))
    const status = await buildPlatformStatus()

    expect(status.ha).toBeNull()
    expect(mocks.orchestratorFetch).not.toHaveBeenCalledWith('/ha/cluster', expect.anything())
  })

  it('stays silent about high availability when the orchestrator cannot give its configuration', async () => {
    mocks.orchestratorFetch.mockImplementation(async (path: string) => {
      if (path === '/ha/config') throw new Error('Orchestrator 404: not found')

      return orchestrator()
    })
    const status = await buildPlatformStatus()

    expect(status.ha).toBeNull()
    expect(status.overall).toBe('up')
    expect(console.error).not.toHaveBeenCalled()
  })

  it('still answers, and logs, when the cluster probe fails', async () => {
    mocks.orchestratorFetch.mockImplementation(haOrchestrator({ deploymentState: 'deployed' }, new Error('Orchestrator 500: probe failed')))
    const status = await buildPlatformStatus()

    expect(status.ha).toBeNull()
    expect(status.orchestrator).not.toBeNull()
    expect(console.error).toHaveBeenCalled()
  })

  it('never asks about high availability on Community', async () => {
    mocks.orchestratorConfigured.mockReturnValue(false)
    await buildPlatformStatus()

    expect(mocks.orchestratorFetch).not.toHaveBeenCalled()
  })
})

describe('overallState with a cluster', () => {
  const up = summarize()

  it('is down without a database primary even when every service of this node runs', () => {
    expect(overallState(up, { vip: '', syncMode: '', paused: false, hasLeader: false, nodes: [] })).toBe('down')
  })

  it('is up with a healthy cluster', () => {
    expect(overallState(up, { vip: '', syncMode: '', paused: false, hasLeader: true, nodes: [] })).toBe('up')
  })
})
