// Site Recovery Types - Ceph RBD cross-cluster replication & disaster recovery

import type { ScheduleSpec } from '@/components/automation/site-recovery/schedule/types'

// ============================================
// Replication Jobs
// ============================================

export type ReplicationJobStatus = 'synced' | 'syncing' | 'error' | 'paused' | 'pending'

export interface BandwidthWindow {
  days: number[]          // 0=Sun, 1=Mon, …, 6=Sat
  start_hour: number      // 0-23
  end_hour: number        // 0-23, wraparound if end <= start
  rate_limit_mbps: number
}

export interface ReplicationJob {
  id: string
  name: string
  vm_ids: number[]
  vm_names: string[]
  tags: string[]            // stored tags for dynamic resolution (empty = VM-based job)
  source_cluster: string
  target_cluster: string
  target_pool: string
  vmid_prefix: number
  status: ReplicationJobStatus
  schedule: string
  schedule_spec: ScheduleSpec | null   // null = RPO mode
  timezone: string                     // IANA, "" = UTC
  rpo_target: number      // seconds
  last_sync?: string | null
  next_sync?: string | null
  throughput_bps: number
  rate_limit_mbps: number
  bandwidth_windows: BandwidthWindow[]
  network_mapping: Record<string, string>  // source bridge → target bridge
  progress_percent: number
  error_message?: string
  created_at: string
  updated_at: string
}

export interface CreateReplicationJobRequest {
  name?: string
  vm_ids: number[]
  tags?: string[]
  source_cluster: string
  target_cluster: string
  target_pool: string
  schedule?: string
  rpo_target?: number
  schedule_spec?: ScheduleSpec | null
  timezone?: string
  rate_limit_mbps: number
  bandwidth_windows?: BandwidthWindow[]
  vmid_prefix?: number
  install_pv?: boolean
  network_mapping: Record<string, string>
}

export interface UpdateReplicationJobRequest {
  name?: string
  schedule_spec?: ScheduleSpec | null
  clear_schedule_spec?: boolean
  timezone?: string
  rpo_target?: number
  rate_limit_mbps?: number
  bandwidth_windows?: BandwidthWindow[]
  network_mapping?: Record<string, string>
}

export interface ReplicationJobLog {
  created_at: string
  level: 'info' | 'warning' | 'error'
  message: string
  bytes_sent: number
  duration_ms: number
}

// ============================================
// Recovery Plans
// ============================================

export type RecoveryPlanStatus = 'ready' | 'degraded' | 'executing' | 'failed' | 'not_ready' | 'failed_over'

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
  target_node?: string
  target_vmid?: number
}

export interface RecoveryExecution {
  id: string
  plan_id: string
  type: RecoveryExecutionType
  status: RecoveryExecutionStatus
  network_isolated?: boolean
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
  total_jobs: number
  rpo_compliance: number  // 0-100 percentage
}

export interface JobStatusSummary {
  synced: number
  syncing: number
  pending: number
  error: number
  paused: number
}

export interface ReplicationHealthStatus {
  sites: SiteInfo[]
  connectivity: 'connected' | 'degraded' | 'disconnected'
  latency_ms: number
  kpis: ReplicationHealthKPIs
  recent_activity: ReplicationActivity[]
  job_summary: JobStatusSummary
}
