// Shape of GET /api/v1/system/status, shared by the route and the Platform
// status tab. Every figure is read without privilege by the service that
// reports it: no Docker socket is involved.

export type ServiceState = 'up' | 'degraded' | 'down' | 'unknown'

export interface HostInfo {
  load1: number
  load5: number
  load15: number
  cpus: number
  memTotalBytes: number
  memAvailableBytes: number
  uptimeSeconds: number
}

export interface ContainerInfo {
  memoryBytes: number
  /** 0 = no limit */
  memoryLimitBytes: number
  /** Share of one core since the previous reading (100 = one full core); null until two readings exist. */
  cpuPercent: number | null
  /** Cores the container may use, 0 = no limit */
  cpuLimit: number
}

export interface DiskInfo {
  label: string
  path: string
  totalBytes: number
  freeBytes: number
}

export interface DatabaseTable {
  name: string
  totalBytes: number
  /** Planner estimate, null when the table was never analysed */
  rows: number | null
  deadRows: number
  lastVacuum: string | null
}

export interface DatabaseInfo {
  version: string
  startedAt: string | null
  sizeBytes: number
  connections: number
  activeConnections: number
  maxConnections: number
  /** Share of block reads served from the buffer cache, 0..100; null before any read */
  cacheHitPercent: number | null
  deadlocks: number
  inRecovery: boolean
  tables: DatabaseTable[]
}

export interface FrontendInfo {
  version: string
  gitSha: string
  nodeVersion: string
  hostname: string
  uptimeSeconds: number
  rssBytes: number
  heapUsedBytes: number
  /** 99th percentile of the event loop delay over the last window, ms */
  eventLoopDelayMs: number | null
}

export interface OrchestratorTask {
  name: string
  schedule: string
  exclusive: boolean
  running: boolean
  runs: number
  failures: number
  last_run?: string
  last_duration_ms: number
  last_error?: string
  last_error_at?: string
  next_run?: string
}

/** GET /api/v1/system/status of the orchestrator, as it answers it. */
export interface OrchestratorStatus {
  version: string
  hostname: string
  started_at: string
  uptime_seconds: number
  leader?: boolean
  runtime: { go_version: string; goroutines: number; heap_alloc_bytes: number; sys_bytes: number; gc_count: number }
  container?: { memory_bytes: number; memory_limit_bytes: number; cpu_limit: number; cpu_percent?: number }
  host?: unknown
  disks: { label: string; path: string; total_bytes: number; free_bytes: number }[]
  db_pool?: { max_open: number; open: number; in_use: number; idle: number; wait_count: number; wait_duration_ms: number }
  renderer: { configured: boolean; healthy: boolean; latency_ms: number; error?: string }
  tasks: OrchestratorTask[]
  retention: Record<string, number>
}

export interface ServiceSummary {
  id: 'frontend' | 'database' | 'orchestrator' | 'renderer'
  state: ServiceState
  version: string | null
  uptimeSeconds: number | null
  cpuPercent: number | null
  memoryBytes: number | null
  memoryLimitBytes: number | null
  /** Short machine-readable reason when the state is not "up" */
  reason: string | null
}

export interface PlatformStatus {
  generatedAt: string
  edition: 'community' | 'enterprise'
  overall: ServiceState
  services: ServiceSummary[]
  frontend: FrontendInfo
  container: ContainerInfo | null
  host: HostInfo | null
  disks: DiskInfo[]
  database: DatabaseInfo | null
  orchestrator: OrchestratorStatus | null
  /** The nodes of the control plane on a high-availability install, null otherwise */
  ha: HaInfo | null
}

export interface HaNodeHost {
  load1: number
  load5: number
  load15: number
  cpus: number
  memTotalBytes: number
  memAvailableBytes: number
}

export interface HaNode {
  name: string
  address: string
  state: ServiceState
  /** Patroni role: leader, sync_standby, replica, standby_leader; null when unreachable */
  dbRole: string | null
  dbState: string | null
  lagBytes: number
  version: string | null
  holdsVip: boolean
  etcdHealthy: boolean
  /** State of each compose service on the node: running, stopped or unknown */
  services: Record<string, string>
  /** Load and memory of the node, null when SSH does not reach it */
  host: HaNodeHost | null
}

export interface HaInfo {
  vip: string
  syncMode: string
  paused: boolean
  hasLeader: boolean
  nodes: HaNode[]
}

export type HostHistoryRange = '1h' | '6h' | '24h'

export interface HostSample {
  /** Epoch milliseconds */
  t: number
  load1: number
  load5: number
  load15: number
  memUsedBytes: number
}

/** GET /api/v1/system/status/history */
export interface HostHistory {
  range: HostHistoryRange
  from: number
  to: number
  /** Width of one point: the sampling interval, or the bucket it was averaged into */
  intervalSeconds: number
  cpus: number
  memTotalBytes: number
  samples: HostSample[]
}
