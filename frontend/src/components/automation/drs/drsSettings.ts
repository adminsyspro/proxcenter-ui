// Shared DRS settings shape + defaults. Imported by both the client-side
// DRSSettingsPanel and the server-side `/api/v1/orchestrator/drs/settings`
// route so the defaults aren't duplicated (SonarCloud flagged the 33-line
// duplicate when the two files maintained parallel copies of every field).

export interface DRSSettings {
  enabled: boolean
  mode: 'manual' | 'partial' | 'automatic'
  balancing_method: 'memory' | 'cpu' | 'disk'
  balancing_mode: 'used' | 'assigned' | 'psi'
  balance_types: ('vm' | 'ct')[]
  maintenance_nodes: string[]
  excluded_clusters: string[]
  excluded_nodes: Record<string, string[]>
  cluster_modes: Record<string, string>
  cpu_high_threshold: number
  cpu_low_threshold: number
  memory_high_threshold: number
  memory_low_threshold: number
  storage_high_threshold: number
  imbalance_threshold: number
  homogenization_enabled: boolean
  max_load_spread: number
  cpu_weight: number
  memory_weight: number
  storage_weight: number
  max_concurrent_migrations: number
  // 0 = legacy / unused. >0 caps how many migrations can be active for one
  // cluster at once. Replaces the global cap as the primary throttle.
  max_concurrent_migrations_per_cluster: number
  // 0 = disabled. >0 caps how many migrations may target the same node in
  // one Rebalance cycle (anti target-flooding).
  max_target_inflow_per_cycle: number
  migration_cooldown: string
  max_pending_recommendations: number
  balance_larger_first: boolean
  prevent_overprovisioning: boolean
  enable_affinity_rules: boolean
  enforce_affinity: boolean
  rebalance_schedule: 'interval' | 'daily'
  rebalance_interval: string
  rebalance_time: string
}

export interface ClusterVersionInfo {
  connectionId: string
  name: string
  version: number // Major version (8 or 9)
}

export const defaultDRSSettings: DRSSettings = {
  enabled: true,
  mode: 'manual',
  balancing_method: 'memory',
  balancing_mode: 'used',
  balance_types: ['vm', 'ct'],
  maintenance_nodes: [],
  excluded_clusters: [],
  excluded_nodes: {},
  cluster_modes: {},
  cpu_high_threshold: 80,
  cpu_low_threshold: 20,
  memory_high_threshold: 85,
  memory_low_threshold: 25,
  storage_high_threshold: 90,
  imbalance_threshold: 5,
  homogenization_enabled: true,
  max_load_spread: 10,
  cpu_weight: 1.0,
  memory_weight: 1.0,
  storage_weight: 0.5,
  max_concurrent_migrations: 2, // Legacy, unused by the engine. Kept for back-compat.
  max_concurrent_migrations_per_cluster: 2,
  max_target_inflow_per_cycle: 0,
  migration_cooldown: '5m',
  max_pending_recommendations: 10,
  balance_larger_first: false,
  prevent_overprovisioning: true,
  enable_affinity_rules: true,
  enforce_affinity: false,
  rebalance_schedule: 'interval',
  rebalance_interval: '1h',
  rebalance_time: '10:00',
}
