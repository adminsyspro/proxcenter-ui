// PURE data modules: imported by BOTH the proxy (D7) and
// principal.ts (D8). NO DB access, ever.
import type { AllowlistEntry } from "./types"

// Phase 1: read-only monitoring.
export const MONITORING_ENTRIES: AllowlistEntry[] = [
  {
    id: "vms-list",
    method: "GET",
    tag: "Monitoring",
    pattern: "/api/v1/vms",
    requiredScopes: ["vms:read"],
    routeFile: "src/app/api/v1/vms/route.ts",
    summary: "List all VMs and containers across visible connections",
    description:
      "Aggregated VM/LXC list with status, usage and config-derived fields (cpuType, scsihw, agentEnabled, bios, ostype, onboot, description, macs) served by default. `ips` merges the addresses pinned in the config with the last known guest agent / LXC addresses from a background index; `staleIps` lists the last known addresses a guest could not re-confirm (stopped, agent down) and `ipIndexWarming` tells that the index is still being built. Pass include=agent to probe the QEMU guest agent on running VMs (about 7x slower).",
    queryParams: [
      { name: "connId", description: "Restrict to a single connection id" },
      { name: "include", description: "Set to 'agent' to probe the guest agent on running VMs" },
    ],
    responseSchemaRef: "VmsResponse",
  },
  {
    id: "inventory-tree",
    method: "GET",
    tag: "Monitoring",
    pattern: "/api/v1/inventory",
    requiredScopes: ["nodes:read"],
    routeFile: "src/app/api/v1/inventory/route.ts",
    summary: "Multi-cluster inventory tree (clusters, nodes, guests, PBS)",
    description:
      "Full inventory tree served from the shared SWR cache, filtered by tenant, vDC and token connection perimeter.",
    queryParams: [{ name: "refresh", description: "Set to 'true' to force a blocking refresh" }],
    responseSchemaRef: "InventoryResponse",
  },
  {
    id: "storage-list",
    method: "GET",
    tag: "Monitoring",
    pattern: "/api/v1/storage",
    requiredScopes: ["storage:read"],
    routeFile: "src/app/api/v1/storage/route.ts",
    summary: "All storages across visible PVE connections",
    description: "Aggregated storage list with capacity and usage per storage.",
    responseSchemaRef: "StorageResponse",
  },
  {
    id: "pbs-backups",
    method: "GET",
    tag: "Monitoring",
    pattern: "/api/v1/pbs/{id}/backups",
    requiredScopes: ["backups:read"],
    connectionSegment: "id",
    routeFile: "src/app/api/v1/pbs/[id]/backups/route.ts",
    summary: "Snapshots of one PBS server",
    description:
      "All snapshots of the given PBS connection (all datastores and namespaces), paginated and filterable. {id} is a raw connection id, validated against the token perimeter before the handler runs.",
    queryParams: [
      { name: "datastore", description: "Filter by datastore name" },
      { name: "namespace", description: "Exact namespace ('' for root)" },
      { name: "type", description: "Filter by backup type: vm, ct or host" },
      { name: "page", description: "Page number (default 1)" },
      { name: "pageSize", description: "Page size (default 50)" },
      { name: "search", description: "Case-insensitive text search" },
    ],
    responseSchemaRef: "PbsBackupsResponse",
  },
  {
    id: "public-backups",
    method: "GET",
    tag: "Monitoring",
    pattern: "/api/v1/public/backups",
    requiredScopes: ["backups:read"],
    routeFile: "src/app/api/v1/public/backups/route.ts",
    summary: "Fleet-wide backup freshness per guest",
    description:
      "For every guest in the token perimeter: most recent backup date, age in seconds, datastore, PBS server, size and verification state. Guests without any backup are present with a null age.",
    responseSchemaRef: "PublicBackupsResponse",
  },
  {
    id: "public-metrics",
    method: "GET",
    tag: "Monitoring",
    pattern: "/api/v1/public/metrics",
    requiredScopes: ["nodes:read", "vms:read", "backups:read"],
    routeFile: "src/app/api/v1/public/metrics/route.ts",
    summary: "Prometheus exposition of fleet metrics",
    description:
      "Prometheus text exposition served from the inventory and PBS caches (never amplified to the hypervisor). Series families are filtered by scope: proxcenter_node_* needs nodes:read, proxcenter_vm_* needs vms:read, proxcenter_backup_* needs backups:read.",
    responseSchemaRef: "PrometheusExposition",
  },
  {
    id: "public-health",
    method: "GET",
    tag: "Monitoring",
    pattern: "/api/v1/public/health",
    requiredScopes: [],
    routeFile: "src/app/api/v1/public/health/route.ts",
    summary: "Application status and per-connection reachability",
    description:
      "Authenticated variant of the public liveness probe: application status plus per-connection reachability derived from the inventory cache, filtered by tenant. Any valid token can call it.",
    responseSchemaRef: "HealthResponse",
  },
]
