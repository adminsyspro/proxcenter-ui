// SINGLE source of truth for every family the exposition can emit: name,
// HELP text and the scope that unlocks it. Three consumers read it and none
// of them may disagree with the others:
//
//   1. the family builders, through `family()` below, so a HELP string is
//      written ONCE and a builder cannot emit an undeclared metric;
//   2. `integrations.test.ts`, which asserts that every committed hub
//      dashboard charts only declared families and leaves none unused;
//   3. `registry.test.ts`, which asserts the declared scope agrees with the
//      prefix table the handler actually enforces (prometheus.ts).
//
// The scope recorded here is DERIVED knowledge, not the enforcement point:
// filtering happens per request in `isFamilyAllowed` off the prefix table.
// A disagreement between the two is a bug in this file, not in the handler.
import type { MetricFamily, Sample } from "@/lib/metrics/prometheus"

export type FamilyDeclaration = {
  name: string
  help: string
  /** null = no prefix match in METRIC_FAMILY_SCOPES, so always visible. */
  scope: string | null
}

export const FAMILY_REGISTRY: readonly FamilyDeclaration[] = [
  {
    name: "proxcenter_build_info",
    help: "ProxCenter build information",
    scope: null,
  },

  {
    name: "proxcenter_cluster_up",
    help: "Cluster or standalone node reachability (1 online, 0 otherwise)",
    scope: "nodes:read",
  },
  {
    name: "proxcenter_cluster_degraded",
    help: "Cluster in a degraded state (1 degraded, 0 otherwise)",
    scope: "nodes:read",
  },
  {
    name: "proxcenter_cluster_ceph_health",
    help: "Ceph health as a state set; health is one of ok, warn, err, unknown. Clusters without Ceph emit nothing",
    scope: "nodes:read",
  },

  {
    name: "proxcenter_node_online",
    help: "Node online state (1 online, 0 otherwise)",
    scope: "nodes:read",
  },
  {
    name: "proxcenter_node_cpu_usage_ratio",
    help: "Node CPU usage ratio (0 to 1)",
    scope: "nodes:read",
  },
  {
    name: "proxcenter_node_mem_usage_ratio",
    help: "Node memory usage ratio (0 to 1)",
    scope: "nodes:read",
  },
  {
    name: "proxcenter_node_mem_bytes",
    help: "Node memory in use, in bytes",
    scope: "nodes:read",
  },
  {
    name: "proxcenter_node_mem_total_bytes",
    help: "Node memory capacity, in bytes",
    scope: "nodes:read",
  },
  {
    name: "proxcenter_node_rootfs_usage_ratio",
    help: "Node root filesystem usage ratio (0 to 1). This is the host root filesystem, NOT cluster storage capacity",
    scope: "nodes:read",
  },
  {
    name: "proxcenter_node_uptime_seconds",
    help: "Node uptime in seconds",
    scope: "nodes:read",
  },
  {
    name: "proxcenter_node_maintenance",
    help: "Node in maintenance mode (1 in maintenance, 0 otherwise)",
    scope: "nodes:read",
  },

  {
    name: "proxcenter_vm_status",
    help: "Guest running state (1 running, 0 otherwise)",
    scope: "vms:read",
  },
  {
    name: "proxcenter_vm_cpu_usage_ratio",
    help: "Guest CPU usage ratio (0 to 1)",
    scope: "vms:read",
  },
  {
    name: "proxcenter_vm_agent_enabled",
    help: "Guest agent config flag (1 enabled, 0 otherwise)",
    scope: "vms:read",
  },
  {
    name: "proxcenter_vm_mem_usage_ratio",
    help: "Guest memory usage ratio (0 to 1)",
    scope: "vms:read",
  },
  {
    name: "proxcenter_vm_mem_bytes",
    help: "Guest memory in use, in bytes",
    scope: "vms:read",
  },
  {
    name: "proxcenter_vm_mem_total_bytes",
    help: "Guest memory allocation, in bytes",
    scope: "vms:read",
  },
  {
    name: "proxcenter_vm_uptime_seconds",
    help: "Guest uptime in seconds",
    scope: "vms:read",
  },
  {
    name: "proxcenter_vm_ha_state",
    help: "Guest HA state as a state set; guests not managed by HA emit nothing",
    scope: "vms:read",
  },

  {
    name: "proxcenter_backup_age_seconds",
    help: "Seconds since the most recent backup of this guest",
    scope: "backups:read",
  },
  {
    name: "proxcenter_backup_protected",
    help: "Guest backup coverage (1 has at least one backup, 0 has none)",
    scope: "backups:read",
  },

  {
    name: "proxcenter_pbs_up",
    help: "PBS server reachability (1 online, 0 otherwise)",
    scope: "backups:read",
  },
  {
    name: "proxcenter_pbs_info",
    help: "PBS server build information",
    scope: "backups:read",
  },
  {
    name: "proxcenter_pbs_datastore_total_bytes",
    help: "Datastore capacity in bytes; 0 for a backend that does not report one, such as S3",
    scope: "backups:read",
  },
  {
    name: "proxcenter_pbs_datastore_used_bytes",
    help: "Datastore space in use, in bytes",
    scope: "backups:read",
  },
  {
    name: "proxcenter_pbs_datastore_available_bytes",
    help: "Datastore space available, in bytes",
    scope: "backups:read",
  },
  {
    name: "proxcenter_pbs_datastore_usage_ratio",
    help: "Datastore usage ratio (0 to 1), served pre-computed so a consumer never divides by a zero capacity",
    scope: "backups:read",
  },
  {
    name: "proxcenter_pbs_datastore_snapshots",
    help: "Snapshots held in this datastore",
    scope: "backups:read",
  },
  {
    name: "proxcenter_pbs_datastore_guests",
    help: "Distinct backup sources in this datastore, by kind (vm, ct, host)",
    scope: "backups:read",
  },
] as const

export const REGISTERED_NAMES: readonly string[] = FAMILY_REGISTRY.map(entry => entry.name)

const BY_NAME = new Map(FAMILY_REGISTRY.map(entry => [entry.name, entry]))

/**
 * Builds a family from its DECLARED help text, so the string lives in one
 * place. Throws on an unregistered name rather than emitting it: a typo in a
 * builder must be a loud failure, not a series no dashboard can chart and no
 * scope can filter.
 */
export function family(name: string, samples: Sample[]): MetricFamily {
  const declaration = BY_NAME.get(name)
  if (!declaration) throw new Error(`Unregistered metric family: ${name}`)
  return { name, help: declaration.help, type: "gauge", samples }
}
