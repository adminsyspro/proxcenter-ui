// Site Recovery Types - Ceph RBD cross-cluster replication & disaster recovery

import type { ScheduleSpec } from '@/components/automation/site-recovery/schedule/types'

// ============================================
// Replication Jobs
// ============================================

export type ReplicationJobStatus = 'synced' | 'syncing' | 'error' | 'paused' | 'pending' | 'failed_over'

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
  retry_count: number
  next_retry_at?: string | null
  throughput_bps: number
  rate_limit_mbps: number
  bandwidth_windows: BandwidthWindow[]
  network_mapping: Record<string, string>  // source bridge → target bridge
  progress_percent: number
  error_message?: string
  created_at: string
  updated_at: string
  snapshot_keep_source?: number
  snapshot_keep_target?: number
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
  snapshot_keep_source?: number
  snapshot_keep_target?: number
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
  snapshot_keep_source?: number
  snapshot_keep_target?: number
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

export type RecoveryPlanStatus = 'ready' | 'degraded' | 'executing' | 'failed' | 'not_ready' | 'failed_over' | 'failing_back'

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
  active_test_execution_id?: string | null
  active_failback_execution_id?: string | null
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
// Restore Points
// ============================================

export interface RestorePoint {
  snapshot: string
  created_ts: number
  created_iso: string
}

export interface VMRestorePoints {
  vm_id: number
  vm_name: string
  target_vmid: number
  job_id?: string
  disk_count: number
  restore_points: RestorePoint[]
  error?: string
}

export interface PlanRestorePoints {
  plan_id: string
  target_cluster: string
  vms: VMRestorePoints[]
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
  // Fine-grained machine code for where a REAL failover or an in-progress
  // failback currently stands for this VM: 'fencing', 'restoring', 'starting'
  // (failover), or a reverse-sync/cutover step code (failback). Cleared ("")
  // once the VM reaches 'completed'; left in place on failure. Never set for
  // a test failover. The UI maps the code to translated prose
  // (siteRecovery.failover.step.*).
  step?: string
  // Reverse-sync progress for a failback in phase 'reverse_sync': when this
  // VM's per-disk delta was last transferred back to the source, and how
  // many bytes it carried. Absent until the first reverse-sync pass for the
  // VM completes.
  last_reverse_sync_at?: string
  last_reverse_sync_bytes?: number
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
  // Fine-grained progress marker for a running execution. For type === 'test',
  // set past VM boot as the post-boot screenshot pipeline advances: 'booting',
  // 'stabilizing', 'capturing', then cleared once it's done. For
  // type === 'failback', tracks the two-phase flow: 'reverse_sync' (ongoing
  // convergence loop back to source) then 'cutover' (operator-triggered
  // switchback), cleared once the failback completes.
  phase?: string
  // Deadline for the current 'stabilizing' phase (ISO timestamp), so the
  // frontend can show a live countdown instead of an indefinite spinner.
  // Cleared alongside phase for every other phase/transition.
  phase_ends_at?: string
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
  rpo_compliance: number   // 0-100 percentage
  concurrent_jobs: number
  max_concurrent_jobs: number
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
