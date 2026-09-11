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
  /**
   * Omitted means gauge. `counter` is declared only for the cumulative byte
   * totals Proxmox reports per guest, and their names end in `_total` to match
   * the Prometheus convention a reader will expect.
   */
  type?: "gauge" | "counter"
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
    name: "proxcenter_node_load1",
    help: "Node load average over one minute",
    scope: "nodes:read",
  },
  {
    name: "proxcenter_node_load5",
    help: "Node load average over five minutes",
    scope: "nodes:read",
  },
  {
    name: "proxcenter_node_load15",
    help: "Node load average over fifteen minutes",
    scope: "nodes:read",
  },
  {
    name: "proxcenter_node_iowait_ratio",
    help: "Share of node CPU time spent waiting on I/O (0 to 1)",
    scope: "nodes:read",
  },
  {
    name: "proxcenter_node_swap_bytes",
    help: "Node swap in use, in bytes",
    scope: "nodes:read",
  },
  {
    name: "proxcenter_node_swap_total_bytes",
    help: "Node swap capacity, in bytes; 0 when the node has no swap",
    scope: "nodes:read",
  },
  {
    name: "proxcenter_node_rootfs_bytes",
    help: "Node root filesystem in use, in bytes",
    scope: "nodes:read",
  },
  {
    name: "proxcenter_node_rootfs_total_bytes",
    help: "Node root filesystem capacity, in bytes",
    scope: "nodes:read",
  },
  {
    name: "proxcenter_node_cpu_cores",
    help: "CPU cores the node reports",
    scope: "nodes:read",
  },
  {
    name: "proxcenter_node_info",
    help: "Node build information: Proxmox VE version and running kernel",
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
    name: "proxcenter_vm_cpu_cores",
    help: "Virtual CPU cores allocated to the guest",
    scope: "vms:read",
  },
  {
    name: "proxcenter_vm_mem_host_bytes",
    help: "Guest memory as the PVE 9 host accounts it, distinct from the guest-side figure; 0 for a container, which reports none",
    scope: "vms:read",
  },
  {
    name: "proxcenter_vm_network_receive_bytes_total",
    help: "Bytes received by the guest since it started",
    scope: "vms:read",
    type: "counter",
  },
  {
    name: "proxcenter_vm_network_transmit_bytes_total",
    help: "Bytes sent by the guest since it started",
    scope: "vms:read",
    type: "counter",
  },
  {
    name: "proxcenter_vm_disk_read_bytes_total",
    help: "Bytes read from the guest's disks since it started",
    scope: "vms:read",
    type: "counter",
  },
  {
    name: "proxcenter_vm_disk_written_bytes_total",
    help: "Bytes written to the guest's disks since it started",
    scope: "vms:read",
    type: "counter",
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

  {
    name: "proxcenter_storage_total_bytes",
    help: "Storage capacity in bytes. A shared storage is reported ONCE for the cluster, never once per node",
    scope: "storage:read",
  },
  {
    name: "proxcenter_storage_used_bytes",
    help: "Storage space in use, in bytes. A shared storage is reported ONCE for the cluster, never once per node",
    scope: "storage:read",
  },
  {
    name: "proxcenter_storage_usage_ratio",
    help: "Storage usage ratio (0 to 1), served pre-computed so a consumer never divides by a zero capacity",
    scope: "storage:read",
  },
  {
    name: "proxcenter_storage_enabled",
    help: "Storage enabled state (1 enabled, 0 disabled); a disabled storage still reports its capacity",
    scope: "storage:read",
  },
  {
    name: "proxcenter_storage_node_total_bytes",
    help: "Capacity of a non-shared storage on one node. Shared storages emit nothing here, since their capacity is not per node",
    scope: "storage:read",
  },
  {
    name: "proxcenter_storage_node_used_bytes",
    help: "Space in use of a non-shared storage on one node",
    scope: "storage:read",
  },
  {
    name: "proxcenter_storage_node_usage_ratio",
    help: "Usage ratio (0 to 1) of a non-shared storage on one node, served pre-computed",
    scope: "storage:read",
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
  return { name, help: declaration.help, type: declaration.type ?? "gauge", samples }
}
