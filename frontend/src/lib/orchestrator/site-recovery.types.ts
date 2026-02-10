// Site Recovery Types - Ceph RBD cross-cluster replication & disaster recovery

// ============================================
// Replication Jobs
// ============================================

export type ReplicationJobStatus = 'synced' | 'syncing' | 'error' | 'paused' | 'pending'

export interface ReplicationJob {
  id: string
  vm_id: number
  vm_name: string
  source_cluster: string
  source_pool: string
  target_cluster: string
  target_pool: string
  status: ReplicationJobStatus
  schedule: string
  rpo_target: number      // seconds
  rpo_actual: number      // seconds
  last_sync: string
  next_sync: string
  volume_bytes: number
  throughput_bps: number
  online_mode: boolean
  rate_limit_mbps: number
  network_mapping: Record<string, string>  // source bridge → target bridge
  progress_percent: number
  error_message?: string
  created_at: string
  updated_at: string
}

export interface CreateReplicationJobRequest {
  vm_ids: number[]
  source_cluster: string
  target_cluster: string
  target_pool: string
  schedule: string
  rpo_target: number
  rate_limit_mbps: number
  online_mode: boolean
  network_mapping: Record<string, string>
}

export interface UpdateReplicationJobRequest {
  schedule?: string
  rpo_target?: number
  rate_limit_mbps?: number
  online_mode?: boolean
  network_mapping?: Record<string, string>
}

export interface ReplicationJobLog {
  timestamp: string
  level: 'info' | 'warning' | 'error'
  message: string
  bytes_transferred: number
  duration_ms: number
}

// ============================================
// Recovery Plans
// ============================================

export type RecoveryPlanStatus = 'ready' | 'degraded' | 'executing' | 'failed' | 'not_ready'

export interface RecoveryPlanVM {
  vm_id: number
  vm_name: string
  replication_job_id: string
  tier: 1 | 2 | 3
  boot_order: number
}

export interface RecoveryPlan {
  id: string
  name: string
  description: string
  status: RecoveryPlanStatus
  source_cluster: string
  target_cluster: string
  vms: RecoveryPlanVM[]
  last_test: string | null
  last_failover: string | null
  created_at: string
  updated_at: string
}

export interface CreateRecoveryPlanRequest {
  name: string
  description: string
  source_cluster: string
  target_cluster: string
  vms: Array<{ vm_id: number; tier: 1 | 2 | 3; boot_order: number }>
}

export interface UpdateRecoveryPlanRequest {
  name?: string
  description?: string
  vms?: Array<{ vm_id: number; tier: 1 | 2 | 3; boot_order: number }>
}

// ============================================
// Recovery Executions
// ============================================

export type RecoveryExecutionType = 'test' | 'failover' | 'failback'
export type RecoveryExecutionStatus = 'running' | 'completed' | 'failed' | 'cancelled'

export interface RecoveryVMResult {
  vm_id: number
  vm_name: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  progress_percent: number
  error?: string
}

export interface RecoveryExecution {
  id: string
  plan_id: string
  type: RecoveryExecutionType
  status: RecoveryExecutionStatus
  started_at: string
  completed_at?: string
  vm_results: RecoveryVMResult[]
}

// ============================================
// Health & Dashboard
// ============================================

export type SiteRole = 'primary' | 'dr'
export type SiteStatus = 'online' | 'degraded' | 'offline'

export interface SiteInfo {
  cluster_id: string
  name: string
  role: SiteRole
  status: SiteStatus
  node_count: number
  vm_count: number
}

export interface ReplicationActivity {
  timestamp: string
  type: 'sync' | 'failover' | 'failback' | 'error' | 'job_created' | 'plan_tested'
  message: string
  severity: 'info' | 'warning' | 'error' | 'success'
}

export interface ReplicationHealthKPIs {
  protected_vms: number
  unprotected_vms: number
  avg_rpo_seconds: number
  last_sync: string
  replicated_bytes: number
  error_count: number
}

export interface ReplicationHealthStatus {
  sites: SiteInfo[]
  connectivity: 'connected' | 'degraded' | 'disconnected'
  latency_ms: number
  kpis: ReplicationHealthKPIs
  recent_activity: ReplicationActivity[]
}
