// Assembles the Platform status page: what this frontend instance reads of
// itself, of its container and of its host, PostgreSQL through the
// application's own connection, and the orchestrator's own report. A part
// that cannot be read is null and marks its service down: the page must
// still load when the thing it watches is the thing that broke.

import os from 'node:os'
import path from 'node:path'
import { monitorEventLoopDelay } from 'node:perf_hooks'

import { APP_VERSION, GIT_SHA } from '@/config/version'
import { isOrchestratorConfigured } from '@/lib/auth/communitySuperAdmin'
import { orchestratorFetch } from '@/lib/orchestrator/client'

import { readDatabase } from './database'
import { haOverall, isClusterConverted, toHaInfo, type HaClusterAnswer, type HaConfigAnswer } from './ha'
import { CpuMeter, diskUsage, readContainer, readHost, toContainerInfo } from './sysinfo'
import type {
  ContainerInfo,
  DatabaseInfo,
  FrontendInfo,
  HaInfo,
  OrchestratorStatus,
  PlatformStatus,
  ServiceState,
  ServiceSummary
} from './types'

// The orchestrator answers from memory; a slow answer is itself a symptom the
// page should show rather than wait for.
const ORCHESTRATOR_TIMEOUT_MS = 8000

const cpuMeter = new CpuMeter()
let loopDelay: ReturnType<typeof monitorEventLoopDelay> | null = null

/** 99th percentile of the event loop delay since the previous call, in ms. */
function eventLoopDelayMs(): number | null {
  if (!loopDelay) {
    loopDelay = monitorEventLoopDelay({ resolution: 20 })
    loopDelay.enable()

    return null
  }

  const p99 = loopDelay.percentile(99) / 1e6

  loopDelay.reset()

  return Number.isFinite(p99) ? p99 : null
}

function readFrontend(): FrontendInfo {
  const mem = process.memoryUsage()

  return {
    version: APP_VERSION,
    gitSha: GIT_SHA,
    nodeVersion: process.version,
    hostname: os.hostname(),
    uptimeSeconds: Math.floor(process.uptime()),
    rssBytes: mem.rss,
    heapUsedBytes: mem.heapUsed,
    eventLoopDelayMs: eventLoopDelayMs()
  }
}

const secondsSince = (iso: string | null | undefined, nowMs: number): number | null => {
  const at = iso ? Date.parse(iso) : Number.NaN

  return Number.isFinite(at) ? Math.max(0, Math.floor((nowMs - at) / 1000)) : null
}

export function summarizeServices(input: {
  edition: PlatformStatus['edition']
  frontend: FrontendInfo
  container: ContainerInfo | null
  database: DatabaseInfo | null
  orchestrator: OrchestratorStatus | null
  nowMs: number
}): ServiceSummary[] {
  const { frontend, container, database, orchestrator, nowMs } = input

  const services: ServiceSummary[] = [
    {
      id: 'frontend',
      state: 'up',
      version: frontend.version,
      uptimeSeconds: frontend.uptimeSeconds,
      cpuPercent: container?.cpuPercent ?? null,
      memoryBytes: container?.memoryBytes ?? frontend.rssBytes,
      memoryLimitBytes: container?.memoryLimitBytes || null,
      reason: null
    },
    {
      id: 'database',
      state: database ? 'up' : 'down',
      version: database?.version ?? null,
      uptimeSeconds: secondsSince(database?.startedAt, nowMs),
      cpuPercent: null,
      memoryBytes: null,
      memoryLimitBytes: null,
      reason: database ? null : 'unreachable'
    }
  ]

  if (input.edition !== 'enterprise') return services

  const failing = orchestrator?.tasks.filter(task => task.last_error).length ?? 0

  services.push({
    id: 'orchestrator',
    state: !orchestrator ? 'down' : failing > 0 ? 'degraded' : 'up',
    version: orchestrator?.version ?? null,
    uptimeSeconds: orchestrator?.uptime_seconds ?? null,
    cpuPercent: orchestrator?.container?.cpu_percent ?? null,
    memoryBytes: orchestrator?.container?.memory_bytes ?? orchestrator?.runtime.sys_bytes ?? null,
    memoryLimitBytes: orchestrator?.container?.memory_limit_bytes || null,
    reason: !orchestrator ? 'unreachable' : failing > 0 ? 'tasksFailing' : null
  })

  const renderer = orchestrator?.renderer
  let rendererState: ServiceState = 'unknown'
  let rendererReason: string | null = 'orchestratorDown'

  if (renderer) {
    rendererState = !renderer.configured ? 'unknown' : renderer.healthy ? 'up' : 'down'
    rendererReason = !renderer.configured ? 'notConfigured' : renderer.healthy ? null : 'unreachable'
  }

  services.push({
    id: 'renderer',
    state: rendererState,
    version: null,
    uptimeSeconds: null,
    cpuPercent: null,
    memoryBytes: null,
    memoryLimitBytes: null,
    reason: rendererReason
  })

  return services
}

// Without the PDF renderer only the PDF reports stop: the platform is
// degraded, not down.
const OPTIONAL_SERVICES: ReadonlySet<ServiceSummary['id']> = new Set(['renderer'])

/**
 * Worst state of the services and, on a high-availability install, of the
 * cluster; "unknown" (nothing to say) never degrades the whole.
 */
export function overallState(services: ServiceSummary[], ha: HaInfo | null = null): ServiceState {
  const cluster = ha ? haOverall(ha) : 'up'

  if (cluster === 'down' || services.some(s => s.state === 'down' && !OPTIONAL_SERVICES.has(s.id))) return 'down'
  if (cluster === 'degraded' || services.some(s => s.state === 'down' || s.state === 'degraded')) return 'degraded'

  return 'up'
}

/**
 * The control-plane nodes when the install runs in high availability, null
 * otherwise or when the orchestrator cannot say. Two calls: the stored
 * configuration (no probe), then the cluster only once it is converted.
 */
async function readHa(): Promise<HaInfo | null> {
  // An orchestrator that is down or was built without the HA service has
  // nothing to say here; its own line already reports the former.
  const config = await orchestratorFetch<HaConfigAnswer>('/ha/config', { timeout: ORCHESTRATOR_TIMEOUT_MS }).catch(() => null)

  if (!isClusterConverted(config)) return null

  return toHaInfo(await orchestratorFetch<HaClusterAnswer>('/ha/cluster', { timeout: ORCHESTRATOR_TIMEOUT_MS }))
}

async function settle<T>(what: string, read: () => Promise<T>): Promise<T | null> {
  try {
    return await read()
  } catch (error: any) {
    if (error?.code !== 'ORCHESTRATOR_UNAVAILABLE') console.error('[system/status] %s unreadable:', what, error?.message ?? error)

    return null
  }
}

export async function buildPlatformStatus(): Promise<PlatformStatus> {
  const edition: PlatformStatus['edition'] = isOrchestratorConfigured() ? 'enterprise' : 'community'
  const dataDir = path.join(process.cwd(), 'data')

  const [host, reading, dataDisk, database, orchestrator, ha] = await Promise.all([
    readHost(),
    readContainer(),
    diskUsage('data', dataDir),
    settle('database', readDatabase),
    edition === 'enterprise'
      ? settle('orchestrator', () => orchestratorFetch<OrchestratorStatus>('/system/status', { timeout: ORCHESTRATOR_TIMEOUT_MS }))
      : Promise.resolve(null),
    edition === 'enterprise' ? settle('high availability', readHa) : Promise.resolve(null)
  ])

  const nowMs = Date.now()
  const frontend = readFrontend()
  const container = reading ? toContainerInfo(reading, cpuMeter, nowMs) : null
  const services = summarizeServices({ edition, frontend, container, database, orchestrator, nowMs })

  const disks = dataDisk ? [dataDisk] : []

  // The orchestrator's own data volume; its view of the shared one is this
  // frontend's data directory again.
  for (const d of orchestrator?.disks ?? []) {
    if (d.label === 'data') disks.push({ label: 'orchestrator', path: d.path, totalBytes: d.total_bytes, freeBytes: d.free_bytes })
  }

  return {
    generatedAt: new Date(nowMs).toISOString(),
    edition,
    overall: overallState(services, ha),
    services,
    frontend,
    container,
    host,
    disks,
    database,
    orchestrator,
    ha
  }
}
