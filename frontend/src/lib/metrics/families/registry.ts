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
//
// SHAPE: one line per family, grouped under the scope that unlocks it. The
// obvious alternative, an array of five-line objects each repeating `name:`,
// `help:` and `scope:`, is what this used to be, and Sonar's copy-paste
// detector normalises string literals, so it saw fifty-three identical
// blocks and put the pull request at 9.1 per cent duplication. Grouping also
// removes a real redundancy: the scope was spelled out once per family when
// it is a property of the PREFIX.
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

/** Sentinel for the families no prefix scopes. */
const UNSCOPED = "__unscoped"

/**
 * The four cumulative families. Everything else is a gauge. Published as a
 * gauge, a counter would still let `rate()` run, but a guest restart resets
 * it and Prometheus would read the reset as an enormous negative rate.
 */
const COUNTERS = new Set([
  "proxcenter_vm_network_receive_bytes_total",
  "proxcenter_vm_network_transmit_bytes_total",
  "proxcenter_vm_disk_read_bytes_total",
  "proxcenter_vm_disk_written_bytes_total",
])

/** Name to HELP text, grouped by the scope that unlocks the prefix. */
const FAMILIES: Record<string, Record<string, string>> = {
  // Always visible: it matches no prefix in METRIC_FAMILY_SCOPES.
  [UNSCOPED]: {
    proxcenter_build_info: "ProxCenter build information",
  },
  // Prefixes proxcenter_cluster_ and proxcenter_node_.
  "nodes:read": {
    proxcenter_cluster_up: "Cluster or standalone node reachability (1 online, 0 otherwise)",
    proxcenter_cluster_degraded: "Cluster in a degraded state (1 degraded, 0 otherwise)",
    proxcenter_cluster_ceph_health: "Ceph health as a state set; health is one of ok, warn, err, unknown. Clusters without Ceph emit nothing",
    proxcenter_node_online: "Node online state (1 online, 0 otherwise)",
    proxcenter_node_cpu_usage_ratio: "Node CPU usage ratio (0 to 1)",
    proxcenter_node_mem_usage_ratio: "Node memory usage ratio (0 to 1)",
    proxcenter_node_mem_bytes: "Node memory in use, in bytes",
    proxcenter_node_mem_total_bytes: "Node memory capacity, in bytes",
    proxcenter_node_rootfs_usage_ratio: "Node root filesystem usage ratio (0 to 1). This is the host root filesystem, NOT cluster storage capacity",
    proxcenter_node_uptime_seconds: "Node uptime in seconds",
    proxcenter_node_maintenance: "Node in maintenance mode (1 in maintenance, 0 otherwise)",
    proxcenter_node_load1: "Node load average over one minute",
    proxcenter_node_load5: "Node load average over five minutes",
    proxcenter_node_load15: "Node load average over fifteen minutes",
    proxcenter_node_iowait_ratio: "Share of node CPU time spent waiting on I/O (0 to 1)",
    proxcenter_node_swap_bytes: "Node swap in use, in bytes",
    proxcenter_node_swap_total_bytes: "Node swap capacity, in bytes; 0 when the node has no swap",
    proxcenter_node_rootfs_bytes: "Node root filesystem in use, in bytes",
    proxcenter_node_rootfs_total_bytes: "Node root filesystem capacity, in bytes",
    proxcenter_node_cpu_cores: "CPU cores the node reports",
    proxcenter_node_info: "Node build information: Proxmox VE version and running kernel",
  },
  // Prefix proxcenter_vm_.
  "vms:read": {
    proxcenter_vm_status: "Guest running state (1 running, 0 otherwise)",
    proxcenter_vm_cpu_usage_ratio: "Guest CPU usage ratio (0 to 1)",
    proxcenter_vm_agent_enabled: "Guest agent config flag (1 enabled, 0 otherwise)",
    proxcenter_vm_mem_usage_ratio: "Guest memory usage ratio (0 to 1)",
    proxcenter_vm_mem_bytes: "Guest memory in use, in bytes",
    proxcenter_vm_mem_total_bytes: "Guest memory allocation, in bytes",
    proxcenter_vm_uptime_seconds: "Guest uptime in seconds",
    proxcenter_vm_ha_state: "Guest HA state as a state set; guests not managed by HA emit nothing",
    proxcenter_vm_cpu_cores: "Virtual CPU cores allocated to the guest",
    proxcenter_vm_mem_host_bytes: "Guest memory as the PVE 9 host accounts it, distinct from the guest-side figure; 0 for a container, which reports none",
    proxcenter_vm_network_receive_bytes_total: "Bytes received by the guest since it started",
    proxcenter_vm_network_transmit_bytes_total: "Bytes sent by the guest since it started",
    proxcenter_vm_disk_read_bytes_total: "Bytes read from the guest's disks since it started",
    proxcenter_vm_disk_written_bytes_total: "Bytes written to the guest's disks since it started",
  },
  // Prefix proxcenter_storage_.
  "storage:read": {
    proxcenter_storage_total_bytes: "Storage capacity in bytes. A shared storage is reported ONCE for the cluster, never once per node",
    proxcenter_storage_used_bytes: "Storage space in use, in bytes. A shared storage is reported ONCE for the cluster, never once per node",
    proxcenter_storage_usage_ratio: "Storage usage ratio (0 to 1), served pre-computed so a consumer never divides by a zero capacity",
    proxcenter_storage_enabled: "Storage enabled state (1 enabled, 0 disabled); a disabled storage still reports its capacity",
    proxcenter_storage_node_total_bytes: "Capacity of a non-shared storage on one node. Shared storages emit nothing here, since their capacity is not per node",
    proxcenter_storage_node_used_bytes: "Space in use of a non-shared storage on one node",
    proxcenter_storage_node_usage_ratio: "Usage ratio (0 to 1) of a non-shared storage on one node, served pre-computed",
  },
  // Prefixes proxcenter_backup_ and proxcenter_pbs_.
  "backups:read": {
    proxcenter_backup_age_seconds: "Seconds since the most recent backup of this guest",
    proxcenter_backup_protected: "Guest backup coverage (1 has at least one backup, 0 has none)",
    proxcenter_pbs_up: "PBS server reachability (1 online, 0 otherwise)",
    proxcenter_pbs_info: "PBS server build information",
    proxcenter_pbs_datastore_total_bytes: "Datastore capacity in bytes; 0 for a backend that does not report one, such as S3",
    proxcenter_pbs_datastore_used_bytes: "Datastore space in use, in bytes",
    proxcenter_pbs_datastore_available_bytes: "Datastore space available, in bytes",
    proxcenter_pbs_datastore_usage_ratio: "Datastore usage ratio (0 to 1), served pre-computed so a consumer never divides by a zero capacity",
    proxcenter_pbs_datastore_snapshots: "Snapshots held in this datastore",
    proxcenter_pbs_datastore_guests: "Distinct backup sources in this datastore, by kind (vm, ct, host)",
  },
}

export const FAMILY_REGISTRY: readonly FamilyDeclaration[] = Object.entries(FAMILIES).flatMap(
  ([scope, families]) =>
    Object.entries(families).map(([name, help]) => ({
      name,
      help,
      scope: scope === UNSCOPED ? null : scope,
      ...(COUNTERS.has(name) ? { type: "counter" as const } : {}),
    })),
)

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
