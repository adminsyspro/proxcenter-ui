// PURE data module: imported by BOTH the proxy (D7) and
// principal.ts (D8). NO DB access, ever.
// Single source of truth for: the proxy derogation, the authorization
// (getPrincipal step 10), the OpenAPI generation and the contract tests.
import { WRITE_SCOPE_IDS } from "./scopes"

export type AllowlistQueryParam = {
  name: string
  description: string
  required?: boolean
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

export type ApiTag =
  | "Monitoring" | "VMs" | "Snapshots" | "Backups" | "Storage"
  | "HA" | "Pools" | "Network" | "Firewall" | "Tasks"

export type BodyOrQueryField = { source: "body" | "query"; field: string }

export type GuestScopeSpec =
  // Path segment names. allowMovedNode: the guest may have left the URL node
  // for another node of the vDC (mirrors the handler's own check).
  | { connection: string; node: string; type: string; vmid: string; allowMovedNode?: true }
  | { vmKey: string } // segment "conn:type:node:vmid"
  | { connection: string; vmidField: BodyOrQueryField } // vmid in body/query, any node/type

export type AllowlistEntry = {
  /** Stable id, carried by the internal x-pxc-entry header. */
  id: string
  method: HttpMethod
  /** Segment-per-segment pattern; {name} = one named dynamic segment. */
  pattern: string
  /** anyOf semantics; empty list = any valid token (health). */
  requiredScopes: string[]
  /** Name of the dynamic segment carrying a RAW connection id, if any (spec layer 1). */
  connectionSegment?: string
  /** Composite segment "conn:type:node:vmid"; the connection is its first field. */
  vmKeySegment?: string
  /** Connection id carried in the body or query string. */
  connectionField?: BodyOrQueryField
  /** The handler resolves the connection itself (pinned list). */
  perimeter?: "handler"
  /** Closed value set for a dynamic segment; keeps {action} from swallowing sibling literals. */
  segmentEnum?: Record<string, readonly string[]>
  /** Values a dynamic segment never takes: static sibling routes Next serves before it. */
  segmentExclude?: Record<string, readonly string[]>
  /** The ONE segment allowed to contain %2F (its decoded value is validated). */
  encodedSlashSegment?: string
  guestScope?: GuestScopeSpec
  clusterObject?: boolean
  secondaryConnections?: BodyOrQueryField[]
  /** Permission keys the handler may check beyond its scope. */
  secondaryPermissions?: string[]
  tag: ApiTag
  /** Route module, repo-frontend-relative; consumed by the contract tests. */
  routeFile: string
  summary: string
  description: string
  queryParams?: AllowlistQueryParam[]
  /** Key into REQUEST_SCHEMAS (openapiSchemas.ts), for entries with a body. */
  requestSchemaRef?: string
  /** Key into RESPONSE_SCHEMAS (openapiSchemas.ts). */
  responseSchemaRef: string
}

// Phase 1: read-only monitoring.
const MONITORING_ENTRIES: AllowlistEntry[] = [
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


// ── VM / container domain (spec 5) ──────────────────────────────────────────
const CONN = "/api/v1/connections/{id}"
const GUEST = `${CONN}/guests/{type}/{node}/{vmid}`
const GUEST_FILE = "src/app/api/v1/connections/[id]/guests/[type]/[node]/[vmid]"
const GUEST_SCOPE: GuestScopeSpec = { connection: "id", node: "node", type: "type", vmid: "vmid" }
const VM_KEY = "/api/v1/guests/{vmid}"
const VM_KEY_FILE = "src/app/api/v1/guests/[vmid]"
/** GET neighbours of the VM write routes: the read scope or any VM write scope. */
const VM_READ_SCOPES = ["vms:read", "vms:power", "vms:write", "vms:snapshot", "vms:migrate", "vms:delete"]
const NIC_IDENTITY_PERMISSIONS = ["vm.config.nic.mac", "vm.config.nic.vlan"]
const VM_POWER_ACTIONS = ["start", "stop", "shutdown", "reboot", "reset", "suspend", "resume"] as const
const TARGET_CONNECTION = [{ source: "body", field: "targetConnectionId" }] satisfies BodyOrQueryField[]

type GuestEntry = Omit<AllowlistEntry, "connectionSegment" | "guestScope" | "tag" | "routeFile"> & { file: string }

/** A route under /connections/{id}/guests/{type}/{node}/{vmid}, confined to the vDC guests. */
function guestEntry({ file, ...entry }: GuestEntry, guestScope: GuestScopeSpec = GUEST_SCOPE): AllowlistEntry {
  return { ...entry, tag: "VMs", connectionSegment: "id", guestScope, routeFile: `${GUEST_FILE}${file}/route.ts` }
}

type VmKeyEntry = Omit<AllowlistEntry, "vmKeySegment" | "guestScope" | "routeFile"> & { file: string }

/** A route under /guests/{vmid}, where {vmid} is the composite key connId:type:node:vmid. */
function vmKeyEntry({ file, ...entry }: VmKeyEntry): AllowlistEntry {
  return { ...entry, vmKeySegment: "vmid", guestScope: { vmKey: "vmid" }, routeFile: `${VM_KEY_FILE}${file}/route.ts` }
}

const VM_ENTRIES: AllowlistEntry[] = [
  {
    id: "vm-create",
    method: "POST",
    tag: "VMs",
    pattern: `${CONN}/guests/{type}/{node}`,
    requiredScopes: ["vms:write"],
    connectionSegment: "id",
    secondaryPermissions: NIC_IDENTITY_PERMISSIONS,
    routeFile: "src/app/api/v1/connections/[id]/guests/[type]/[node]/route.ts",
    summary: "Create a VM or a container",
    description:
      "Creates a QEMU VM ({type} = qemu) or an LXC container ({type} = lxc) on {node}. The body is the Proxmox create parameter set, forwarded once the vDC rules have run: a vDC tenant gets its pool, CPU policy, storage, network and quota enforced, and an IPAM address injected on managed bridges. Setting a NIC MAC or VLAN as a vDC tenant also needs vm.config.nic.mac / vm.config.nic.vlan, which no scope grants.",
    requestSchemaRef: "VmCreateRequest",
    responseSchemaRef: "VmCreateResponse",
  },
  guestEntry({
    id: "vm-config-get",
    method: "GET",
    file: "/config",
    pattern: `${GUEST}/config`,
    requiredScopes: VM_READ_SCOPES,
    summary: "Guest configuration",
    description:
      "The effective Proxmox configuration of the guest, with `pending` listing the changes that wait for a reboot. When the guest has moved to another node of the cluster since the URL was built, the configuration is read from its current node and `movedTo` names it.",
    responseSchemaRef: "VmConfigResponse",
  }, { ...GUEST_SCOPE, allowMovedNode: true }),
  guestEntry({
    id: "vm-config-update",
    method: "PUT",
    file: "/config",
    pattern: `${GUEST}/config`,
    requiredScopes: ["vms:write"],
    secondaryPermissions: NIC_IDENTITY_PERMISSIONS,
    summary: "Update the guest configuration",
    description:
      "Writes the given Proxmox configuration keys (CPU, memory, disks, NICs, options, cloud-init, `delete`, `revert`). Keys the route does not forward for this guest type are dropped. Answers 202 with `pending: true` when the Proxmox task outlives the request; follow its UPID. Changing a NIC MAC or VLAN as a vDC tenant also needs vm.config.nic.mac / vm.config.nic.vlan, which no scope grants.",
    requestSchemaRef: "VmConfigUpdateRequest",
    responseSchemaRef: "VmConfigUpdateResponse",
  }),
  guestEntry({
    id: "vm-power",
    method: "POST",
    file: "/[action]",
    pattern: `${GUEST}/{action}`,
    requiredScopes: ["vms:power"],
    segmentEnum: { action: VM_POWER_ACTIONS },
    summary: "Power action on a guest",
    description: "Starts, stops (hard), shuts down (ACPI), reboots, resets, suspends or resumes the guest. No body.",
    responseSchemaRef: "VmPowerResponse",
  }),
  guestEntry({
    id: "vm-clone",
    method: "POST",
    file: "/clone",
    pattern: `${GUEST}/clone`,
    requiredScopes: ["vms:write"],
    summary: "Clone a guest",
    description:
      "Clones the guest (or a template) to `newid`. Other Proxmox clone parameters pass through. A vDC tenant clone stays in its pool, storages and quota.",
    requestSchemaRef: "VmCloneRequest",
    responseSchemaRef: "VmTaskMessageResponse",
  }),
  guestEntry({
    id: "vm-template",
    method: "POST",
    file: "/template",
    pattern: `${GUEST}/template`,
    requiredScopes: ["vms:write"],
    summary: "Convert a guest to a template",
    description: "Irreversible. The guest must be stopped. No body.",
    responseSchemaRef: "VmTaskMessageResponse",
  }),
  guestEntry({
    id: "vm-disk-resize",
    method: "POST",
    file: "/disk/resize",
    pattern: `${GUEST}/disk/resize`,
    requiredScopes: ["vms:write"],
    summary: "Resize a guest disk",
    description: "Grows a disk (e.g. size `+10G`). A vDC tenant growth counts against its storage quota.",
    requestSchemaRef: "VmDiskResizeRequest",
    responseSchemaRef: "VmSuccessTaskResponse",
  }),
  guestEntry({
    id: "vm-disk-move",
    method: "POST",
    file: "/disk/move",
    pattern: `${GUEST}/disk/move`,
    requiredScopes: ["vms:write"],
    summary: "Move a guest disk to another storage",
    description: "Moves a disk to `storage`. A vDC tenant may only target its own writable storages, within quota.",
    requestSchemaRef: "VmDiskMoveRequest",
    responseSchemaRef: "VmSuccessTaskResponse",
  }),
  guestEntry({
    id: "vm-unlock-get",
    method: "GET",
    file: "/unlock",
    pattern: `${GUEST}/unlock`,
    requiredScopes: VM_READ_SCOPES,
    summary: "Guest lock state",
    description: "Whether the guest carries a Proxmox lock (backup, migrate, snapshot, ...) and which one.",
    responseSchemaRef: "VmLockStateResponse",
  }),
  guestEntry({
    id: "vm-unlock",
    method: "POST",
    file: "/unlock",
    pattern: `${GUEST}/unlock`,
    requiredScopes: ["vms:write"],
    summary: "Remove the lock of a guest",
    description: "Runs `qm unlock` / `pct unlock` on the node over SSH. A guest that is not locked answers `unlocked: false`. No body.",
    responseSchemaRef: "VmUnlockResponse",
  }),
  guestEntry({
    id: "vm-migrate",
    method: "POST",
    file: "/migrate",
    pattern: `${GUEST}/migrate`,
    requiredScopes: ["vms:migrate"],
    summary: "Migrate a guest to another node of its cluster",
    description: "Intra-cluster migration to `target`. Refused while snapshots block the migration.",
    requestSchemaRef: "VmMigrateRequest",
    responseSchemaRef: "VmSuccessTaskResponse",
  }),
  guestEntry({
    id: "vm-remote-migrate",
    method: "POST",
    file: "/remote-migrate",
    pattern: `${GUEST}/remote-migrate`,
    requiredScopes: ["vms:migrate"],
    secondaryConnections: TARGET_CONNECTION,
    summary: "Migrate a VM to another cluster",
    description:
      "Cross-cluster migration (Proxmox remote_migrate) of a QEMU VM. `targetConnectionId` must also be inside the token perimeter. Reserved to the provider and to the MSP tenant that owns both connections.",
    requestSchemaRef: "VmRemoteMigrateRequest",
    responseSchemaRef: "VmRemoteMigrateResponse",
  }),
  guestEntry({
    id: "vm-remote-migrate-check",
    method: "POST",
    file: "/remote-migrate/check",
    pattern: `${GUEST}/remote-migrate/check`,
    requiredScopes: ["vms:migrate"],
    secondaryConnections: TARGET_CONNECTION,
    summary: "Preflight a cross-cluster migration",
    description:
      "Validates a cross-cluster migration before launching it: blocking errors and warnings (HA, replication, snapshots, CPU, storage, bridge, VMID collision). Changes nothing. `targetConnectionId` must also be inside the token perimeter.",
    requestSchemaRef: "VmRemoteMigrateCheckRequest",
    responseSchemaRef: "VmRemoteMigrateCheckResponse",
  }),
  guestEntry({
    id: "vm-remote-migrate-prepare-get",
    method: "GET",
    file: "/remote-migrate/prepare",
    pattern: `${GUEST}/remote-migrate/prepare`,
    requiredScopes: VM_READ_SCOPES,
    summary: "Cross-cluster migration prerequisites of a VM",
    description: "The HA resource, replication jobs, snapshots and Site Recovery jobs that stand in the way of a cross-cluster migration.",
    responseSchemaRef: "VmMigratePrerequisitesResponse",
  }),
  guestEntry({
    id: "vm-remote-migrate-prepare",
    method: "POST",
    file: "/remote-migrate/prepare",
    pattern: `${GUEST}/remote-migrate/prepare`,
    requiredScopes: ["vms:migrate"],
    secondaryPermissions: ["vm.snapshot", "node.manage"],
    summary: "Clear cross-cluster migration prerequisites",
    description:
      "Captures, then removes, the requested blockers: HA resource and replication jobs (also need node.manage on the connection) and the named snapshots (also need vm.snapshot, irreversible). The capture is returned so the migration can restore it.",
    requestSchemaRef: "VmRemoteMigratePrepareRequest",
    responseSchemaRef: "VmRemoteMigratePrepareResponse",
  }),
  guestEntry({
    id: "vm-delete",
    method: "DELETE",
    file: "",
    pattern: GUEST,
    requiredScopes: ["vms:delete"],
    summary: "Delete a guest",
    description: "Destroys the guest. It must be stopped and unlocked. Its IPAM addresses are released.",
    queryParams: [
      { name: "purge", description: "Set to '1' to also remove the guest from backup jobs, replication and HA" },
      { name: "destroy-unreferenced-disks", description: "Set to '1' to also destroy disks not referenced in the config" },
    ],
    responseSchemaRef: "VmDeleteResponse",
  }),
  vmKeyEntry({
    id: "vm-notes-get",
    method: "GET",
    tag: "VMs",
    file: "/notes",
    pattern: `${VM_KEY}/notes`,
    requiredScopes: VM_READ_SCOPES,
    summary: "Guest notes",
    description: "The guest description (notes). {vmid} is the composite key connId:type:node:vmid.",
    responseSchemaRef: "VmNotesResponse",
  }),
  vmKeyEntry({
    id: "vm-notes-update",
    method: "PUT",
    tag: "VMs",
    file: "/notes",
    pattern: `${VM_KEY}/notes`,
    requiredScopes: ["vms:write"],
    summary: "Update the guest notes",
    description: "Replaces the guest description (notes). {vmid} is the composite key connId:type:node:vmid.",
    requestSchemaRef: "VmNotesUpdateRequest",
    responseSchemaRef: "VmNotesUpdateResponse",
  }),
  vmKeyEntry({
    id: "vm-snapshots-list",
    method: "GET",
    tag: "Snapshots",
    file: "/snapshots",
    pattern: `${VM_KEY}/snapshots`,
    requiredScopes: VM_READ_SCOPES,
    summary: "Guest snapshots",
    description: "Snapshots of the guest, newest first. {vmid} is the composite key connId:type:node:vmid.",
    responseSchemaRef: "VmSnapshotsResponse",
  }),
  vmKeyEntry({
    id: "vm-snapshot-create",
    method: "POST",
    tag: "Snapshots",
    file: "/snapshots",
    pattern: `${VM_KEY}/snapshots`,
    requiredScopes: ["vms:snapshot"],
    summary: "Take a snapshot",
    description: "Takes a snapshot of the guest. `vmstate` (QEMU only) also saves the RAM. {vmid} is the composite key connId:type:node:vmid.",
    requestSchemaRef: "VmSnapshotCreateRequest",
    responseSchemaRef: "VmSnapshotTaskResponse",
  }),
  vmKeyEntry({
    id: "vm-snapshot-delete",
    method: "DELETE",
    tag: "Snapshots",
    file: "/snapshots",
    pattern: `${VM_KEY}/snapshots`,
    requiredScopes: ["vms:snapshot"],
    summary: "Delete a snapshot",
    description: "Deletes the snapshot named by `name`. {vmid} is the composite key connId:type:node:vmid.",
    queryParams: [
      { name: "name", description: "Snapshot name", required: true },
      { name: "wait", description: "Set to '1' to answer once the Proxmox task has finished" },
    ],
    responseSchemaRef: "VmSnapshotTaskResponse",
  }),
  vmKeyEntry({
    id: "vm-snapshot-rollback",
    method: "POST",
    tag: "Snapshots",
    file: "/snapshots/[snapname]",
    pattern: `${VM_KEY}/snapshots/{snapname}`,
    requiredScopes: ["vms:snapshot"],
    summary: "Roll a guest back to a snapshot",
    description: "Rolls the guest back to {snapname}. No body. {vmid} is the composite key connId:type:node:vmid.",
    responseSchemaRef: "VmSnapshotTaskResponse",
  }),
  vmKeyEntry({
    id: "vm-snapshot-update",
    method: "PUT",
    tag: "Snapshots",
    file: "/snapshots/[snapname]",
    pattern: `${VM_KEY}/snapshots/{snapname}`,
    requiredScopes: ["vms:snapshot"],
    summary: "Update a snapshot description",
    description: "Replaces the description of {snapname}. {vmid} is the composite key connId:type:node:vmid.",
    requestSchemaRef: "VmSnapshotUpdateRequest",
    responseSchemaRef: "VmSnapshotUpdateResponse",
  }),
  vmKeyEntry({
    id: "vm-tasks-list",
    method: "GET",
    tag: "Tasks",
    file: "/tasks",
    pattern: `${VM_KEY}/tasks`,
    requiredScopes: VM_READ_SCOPES,
    summary: "Recent tasks of a guest",
    description: "The last 50 Proxmox tasks of the guest on its node, newest first. {vmid} is the composite key connId:type:node:vmid.",
    responseSchemaRef: "VmTasksResponse",
  }),
  {
    id: "task-status",
    method: "GET",
    tag: "Tasks",
    pattern: "/api/v1/tasks/{connectionId}/{node}/{upid}",
    requiredScopes: WRITE_SCOPE_IDS,
    connectionSegment: "connectionId",
    routeFile: "src/app/api/v1/tasks/[connectionId]/[node]/[upid]/route.ts",
    summary: "Status of a Proxmox task",
    description:
      "Status, progress and log of the task {upid} started on {node}, as returned by every write that answers with a UPID. Poll it until `status` is `stopped`, then read `exitstatus` (`OK` on success) and `failureReason`. Any write scope opens it. A vDC tenant token only reads the tasks of its own guests.",
    queryParams: [{ name: "summary", description: "Set to '1' to skip the log lines" }],
    responseSchemaRef: "TaskStatusResponse",
  },
]

// ── Backups domain (spec 5) ──────────────────────────────────────────────────
const BACKUP_JOB = `${CONN}/backup-jobs/{jobId}`
const BACKUP_JOB_FILE = "connections/[id]/backup-jobs/[jobId]"
const PBS = "/api/v1/pbs/{id}"
const GFR = "/api/v1/guest-file-restore"
/** GET neighbours of the backup write routes: the read scope or any backup write scope. */
const BACKUP_READ_SCOPES = ["backups:read", "backups:write", "backups:restore", "backups:delete"]
/** backup-jobs/runs is a static sibling of backup-jobs/{jobId}: Next serves it first. */
const NOT_RUNS = { jobId: ["runs"] } as const
const PBS_JOB_KINDS = { prune: "prune", sync: "sync", verify: "verify", tape: "tape backup" } as const
const PBS_RUN_KINDS = { sync: "sync job", verify: "verify job", tape: "tape backup job", gc: "garbage collection" } as const

type BackupEntry = Omit<AllowlistEntry, "tag" | "routeFile"> & { file: string }

/** A backup route; `file` is its directory under src/app/api/v1. */
function backupEntry({ file, ...entry }: BackupEntry): AllowlistEntry {
  return { ...entry, tag: "Backups", routeFile: `src/app/api/v1/${file}/route.ts` }
}

const pascal = (kind: string) => kind[0].toUpperCase() + kind.slice(1)

/** Config writes of the PBS sync / verify / prune / tape backup jobs: one literal route per kind. */
function pbsJobConfigEntries(kind: keyof typeof PBS_JOB_KINDS): AllowlistEntry[] {
  const label = `${PBS_JOB_KINDS[kind]} job`
  const shared = { requiredScopes: ["backups:write"], connectionSegment: "id", clusterObject: true }
  return [
    backupEntry({
      ...shared,
      id: `pbs-job-${kind}-create`,
      method: "POST",
      file: `pbs/[id]/jobs/${kind}`,
      pattern: `${PBS}/jobs/${kind}`,
      summary: `Create a PBS ${label}`,
      description: `Creates a ${label} on the PBS server {id}. Not available to a vDC tenant token.`,
      requestSchemaRef: `Pbs${pascal(kind)}JobCreateRequest`,
      responseSchemaRef: "PbsJobConfigResponse",
    }),
    backupEntry({
      ...shared,
      id: `pbs-job-${kind}-update`,
      method: "PUT",
      file: `pbs/[id]/jobs/${kind}/[jobId]`,
      pattern: `${PBS}/jobs/${kind}/{jobId}`,
      summary: `Update a PBS ${label}`,
      description: `Changes the given properties of the ${label} {jobId}; an absent field is left as is, an empty one clears an optional property. Not available to a vDC tenant token.`,
      requestSchemaRef: `Pbs${pascal(kind)}JobUpdateRequest`,
      responseSchemaRef: "PbsJobConfigResponse",
    }),
    backupEntry({
      ...shared,
      id: `pbs-job-${kind}-delete`,
      method: "DELETE",
      file: `pbs/[id]/jobs/${kind}/[jobId]`,
      pattern: `${PBS}/jobs/${kind}/{jobId}`,
      summary: `Delete a PBS ${label}`,
      description: `Removes the ${label} {jobId}. The backups it produced stay. Not available to a vDC tenant token.`,
      responseSchemaRef: "MessageResponse",
    }),
  ]
}

function pbsJobRunEntry(kind: keyof typeof PBS_RUN_KINDS): AllowlistEntry {
  return backupEntry({
    id: `pbs-job-${kind}-run`,
    method: "POST",
    file: `pbs/[id]/jobs/${kind}/[jobId]/run`,
    pattern: `${PBS}/jobs/${kind}/{jobId}/run`,
    requiredScopes: ["backups:write"],
    connectionSegment: "id",
    clusterObject: true,
    summary: `Run a PBS ${PBS_RUN_KINDS[kind]} now`,
    description:
      (kind === "gc" ? "Starts a garbage collection of a datastore; {jobId} is `gc-<datastore>`." : `Starts the ${PBS_RUN_KINDS[kind]} {jobId} now.`) +
      " `data` is the PBS task UPID. No body. Not available to a vDC tenant token.",
    responseSchemaRef: "PbsTaskMessageResponse",
  })
}

const BACKUP_ENTRIES: AllowlistEntry[] = [
  backupEntry({
    id: "backup-jobs-list",
    method: "GET",
    file: "connections/[id]/backup-jobs",
    pattern: `${CONN}/backup-jobs`,
    requiredScopes: BACKUP_READ_SCOPES,
    connectionSegment: "id",
    summary: "Backup jobs of a cluster",
    description:
      "The vzdump backup jobs of the cluster, with the backup storages and nodes a job may use. A vDC tenant only sees the jobs of its own pools and the storages and nodes of its vDC.",
    responseSchemaRef: "BackupJobsResponse",
  }),
  backupEntry({
    id: "backup-job-create",
    method: "POST",
    file: "connections/[id]/backup-jobs",
    pattern: `${CONN}/backup-jobs`,
    requiredScopes: ["backups:write"],
    connectionSegment: "id",
    summary: "Create a backup job",
    description:
      "Creates a scheduled vzdump job. A vDC tenant job must select one of its pools, be pinned to one of its nodes and write to one of its storages.",
    requestSchemaRef: "BackupJobCreateRequest",
    responseSchemaRef: "BackupJobWriteResponse",
  }),
  backupEntry({
    id: "backup-job-get",
    method: "GET",
    file: BACKUP_JOB_FILE,
    pattern: BACKUP_JOB,
    requiredScopes: BACKUP_READ_SCOPES,
    connectionSegment: "id",
    segmentExclude: NOT_RUNS,
    summary: "Backup job",
    description: "The Proxmox configuration of the backup job {jobId}.",
    responseSchemaRef: "BackupJobResponse",
  }),
  backupEntry({
    id: "backup-job-update",
    method: "PUT",
    file: BACKUP_JOB_FILE,
    pattern: BACKUP_JOB,
    requiredScopes: ["backups:write"],
    connectionSegment: "id",
    segmentExclude: NOT_RUNS,
    summary: "Update a backup job",
    description:
      "Changes the given fields of the backup job {jobId}; absent fields are left as they are. A vDC tenant stays inside its pools, nodes and storages.",
    requestSchemaRef: "BackupJobUpdateRequest",
    responseSchemaRef: "BackupJobWriteResponse",
  }),
  backupEntry({
    id: "backup-job-delete",
    method: "DELETE",
    file: BACKUP_JOB_FILE,
    pattern: BACKUP_JOB,
    requiredScopes: ["backups:write"],
    connectionSegment: "id",
    segmentExclude: NOT_RUNS,
    summary: "Delete a backup job",
    description: "Removes the backup job {jobId}. The backups it produced stay.",
    responseSchemaRef: "MessageResponse",
  }),
  backupEntry({
    id: "backup-job-run",
    method: "POST",
    file: BACKUP_JOB_FILE,
    pattern: BACKUP_JOB,
    requiredScopes: ["backups:write"],
    connectionSegment: "id",
    segmentExclude: NOT_RUNS,
    summary: "Run a backup job now",
    description:
      "Starts the backup job {jobId} with its own options, one vzdump task per node that hosts its guests. `tasks` lists the UPID started on each node. No body.",
    queryParams: [{ name: "action", description: "Must be 'run'; any other value answers 400", required: true }],
    responseSchemaRef: "BackupJobRunResponse",
  }),
  backupEntry({
    id: "backup-job-guests",
    method: "POST",
    file: `${BACKUP_JOB_FILE}/guests`,
    pattern: `${BACKUP_JOB}/guests`,
    requiredScopes: ["backups:write"],
    connectionSegment: "id",
    summary: "Add a guest to a backup job",
    description:
      "Adds the guest `vmid` to the selection of the backup job {jobId}: an `all` job drops it from its exclusions, a vmid-list job gets it appended. Pool jobs, jobs pinned to another node and jobs that already select it answer 409 with the reason. Not available to a vDC tenant.",
    requestSchemaRef: "BackupJobGuestsRequest",
    responseSchemaRef: "BackupJobGuestsResponse",
  }),
  backupEntry({
    id: "vm-backup-now",
    method: "POST",
    file: "connections/[id]/nodes/[node]/vzdump",
    pattern: `${CONN}/nodes/{node}/vzdump`,
    requiredScopes: ["backups:write"],
    connectionSegment: "id",
    guestScope: { connection: "id", vmidField: { source: "body", field: "vmid" } },
    summary: "Back up guests now",
    description:
      "Starts a vzdump backup of `vmid` (one id or a comma-separated list) on {node} to `storage`. A vDC tenant token only backs up guests of its own vDC, to one of its writable storages.",
    requestSchemaRef: "VmBackupNowRequest",
    responseSchemaRef: "VmSuccessTaskResponse",
  }),
  backupEntry({
    id: "vm-restore",
    method: "POST",
    file: "connections/[id]/nodes/[node]/restore",
    pattern: `${CONN}/nodes/{node}/restore`,
    requiredScopes: ["backups:restore"],
    connectionSegment: "id",
    secondaryPermissions: ["vm.delete"],
    summary: "Restore a guest from a backup",
    description:
      "Restores `archive` (a Proxmox volume id) or `pbsBackup` (PBS coordinates, mapped to the PVE storage of {node} that targets them) as guest `vmid` on {node}. `pbsBackup.pbsId` must also be inside the token perimeter. `force` overwrites the guest holding `vmid`, which also needs vm.delete on it (scope vms:delete). A vDC tenant restores on its own nodes, from and to its own storages.",
    requestSchemaRef: "VmRestoreRequest",
    responseSchemaRef: "VmSuccessTaskResponse",
  }),
  backupEntry({
    id: "pbs-backup-delete",
    method: "DELETE",
    file: "pbs/[id]/backups/[backupId]",
    pattern: `${PBS}/backups/{backupId}`,
    requiredScopes: ["backups:delete"],
    connectionSegment: "id",
    encodedSlashSegment: "backupId",
    summary: "Delete a PBS snapshot",
    description:
      "Deletes one snapshot. {backupId} is `datastore/[namespace/]type/id/epoch` URL-encoded as a single segment (`/` as %2F), as listed by GET /api/v1/pbs/{id}/backups. A protected snapshot is refused by PBS. Irreversible.",
    queryParams: [{ name: "ns", description: "Namespace; overrides the one carried by {backupId}" }],
    responseSchemaRef: "SuccessResponse",
  }),
  backupEntry({
    id: "pbs-backup-verify",
    method: "POST",
    file: "pbs/[id]/backups/[backupId]/verify",
    pattern: `${PBS}/backups/{backupId}/verify`,
    requiredScopes: ["backups:write"],
    connectionSegment: "id",
    encodedSlashSegment: "backupId",
    summary: "Verify a PBS snapshot",
    description:
      "Re-verifies the chunks of one snapshot. {backupId} is `datastore/[namespace/]type/id/epoch` URL-encoded as a single segment (`/` as %2F). `data` is the PBS task UPID. No body.",
    queryParams: [{ name: "ns", description: "Namespace; overrides the one carried by {backupId}" }],
    responseSchemaRef: "PbsTaskResponse",
  }),
  ...(Object.keys(PBS_JOB_KINDS) as Array<keyof typeof PBS_JOB_KINDS>).flatMap(pbsJobConfigEntries),
  ...(Object.keys(PBS_RUN_KINDS) as Array<keyof typeof PBS_RUN_KINDS>).map(pbsJobRunEntry),
  backupEntry({
    id: "gfr-probe",
    method: "POST",
    file: "guest-file-restore/probe",
    pattern: `${GFR}/probe`,
    requiredScopes: ["backups:restore"],
    perimeter: "handler",
    summary: "Test the connection to a file restore target",
    description:
      "Reaches the guest that would receive restored files, by guest agent or SSH, and reports its OS plus, for SSH, the host key fingerprint to send back with the job. Answers 200 with `ok: false` when the guest cannot be reached. `target.connId` must be inside the token perimeter and, for a vDC tenant token, the guest inside its vDC (checked by the handler: the field is nested).",
    requestSchemaRef: "GfrProbeRequest",
    responseSchemaRef: "GfrProbeResponse",
  }),
  backupEntry({
    id: "gfr-jobs-list",
    method: "GET",
    file: "guest-file-restore/jobs",
    pattern: `${GFR}/jobs`,
    requiredScopes: BACKUP_READ_SCOPES,
    connectionField: { source: "query", field: "connId" },
    summary: "File restore jobs",
    description: "The file restore jobs of the tenant on one connection, newest first; poll it to follow a job.",
    queryParams: [
      { name: "connId", description: "Connection id; required for an API token and inside its perimeter", required: true },
      { name: "vmid", description: "Only the jobs restoring to this guest" },
      { name: "limit", description: "Maximum number of jobs (1-200, default 50)" },
    ],
    responseSchemaRef: "GfrJobsResponse",
  }),
  backupEntry({
    id: "gfr-job-create",
    method: "POST",
    file: "guest-file-restore/jobs",
    pattern: `${GFR}/jobs`,
    requiredScopes: ["backups:restore"],
    perimeter: "handler",
    summary: "Restore files into a guest",
    description:
      "Copies files and folders of a backup (a PVE backup volume or a PBS pxar archive) into a running guest, by guest agent or SSH (host key fingerprint from the probe required). Answers 202 with the job id; the job runs after the response. `target.connId` and the source connection must be inside the token perimeter and, for a vDC tenant token, the target guest inside its vDC (checked by the handler: the fields are nested).",
    requestSchemaRef: "GfrJobCreateRequest",
    responseSchemaRef: "GfrJobCreatedResponse",
  }),
  backupEntry({
    id: "gfr-job-cancel",
    method: "POST",
    file: "guest-file-restore/jobs/[id]/cancel",
    pattern: `${GFR}/jobs/{id}/cancel`,
    requiredScopes: ["backups:restore"],
    perimeter: "handler",
    summary: "Cancel a file restore job",
    description: "Cancels a queued or running file restore job {id}. The handler resolves the job's guest and checks it against the token. No body.",
    responseSchemaRef: "GfrJobResponse",
  }),
]

export const PUBLIC_API_ALLOWLIST: AllowlistEntry[] = [...MONITORING_ENTRIES, ...VM_ENTRIES, ...BACKUP_ENTRIES]

const ENTRIES_BY_ID = new Map(PUBLIC_API_ALLOWLIST.map(e => [e.id, e]))

export function getAllowlistEntryById(id: string): AllowlistEntry | null {
  return ENTRIES_BY_ID.get(id) ?? null
}

/**
 * Structural pre-match rejections (spec section 8): empty segment (double
 * slash), '.' or '..' segments, trailing slash on a non-root path.
 */
function hasStructuralRejection(pathname: string): boolean {
  if (pathname !== "/" && pathname.endsWith("/")) return true
  const segments = pathname.split("/").slice(1)
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") return true
  }
  return false
}

function hasEncodedSlash(value: string): boolean {
  const lower = value.toLowerCase()
  return lower.includes("%2f") || lower.includes("%5c")
}

/**
 * Pre-match rejections: the structural ones plus an encoded slash or
 * backslash anywhere. Only an entry declaring encodedSlashSegment lifts the
 * latter, for that one segment (see matchPattern). Rejection = no match = the
 * existing proxy cookie 401, nothing is disclosed.
 */
export function isRejectedPath(pathname: string): boolean {
  return hasEncodedSlash(pathname) || hasStructuralRejection(pathname)
}

/** Decoded value of the encodedSlashSegment: no backslash, no empty/'.'/'..' sub-segment. */
function isSafeEncodedSlashValue(raw: string): boolean {
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return false
  }
  if (decoded.includes("\\")) return false
  return !decoded.split("/").some(part => part === "" || part === "." || part === "..")
}

function matchPattern(entry: AllowlistEntry, pathname: string): Record<string, string> | null {
  if (hasStructuralRejection(pathname)) return null
  const patternSegments = entry.pattern.split("/").slice(1)
  const pathSegments = pathname.split("/").slice(1)
  if (patternSegments.length !== pathSegments.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < patternSegments.length; i++) {
    const p = patternSegments[i]
    const value = pathSegments[i]
    const isDynamic = p.startsWith("{") && p.endsWith("}")
    const name = isDynamic ? p.slice(1, -1) : null
    if (hasEncodedSlash(value)) {
      if (name === null || name !== entry.encodedSlashSegment || !isSafeEncodedSlashValue(value)) return null
    }
    if (name !== null) {
      const allowed = entry.segmentEnum?.[name]
      if (allowed && !allowed.includes(value)) return null
      // An escaped spelling (%72uns) is refused, never decoded and compared.
      const excluded = entry.segmentExclude?.[name]
      if (excluded && (value.includes("%") || excluded.includes(value))) return null
      params[name] = value
    } else if (p !== value) {
      return null
    }
  }
  return params
}

export type AllowlistMatch = { ok: boolean; entryId?: string; params?: Record<string, string> }

/** HEAD is served by the GET entry. */
function effectiveMethod(method: string): string {
  return method === "HEAD" ? "GET" : method
}

/** Matcher core, exported for tests that inject synthetic entries. */
export function _matchAgainst(entries: AllowlistEntry[], pathname: string, method: string): AllowlistMatch {
  const wanted = effectiveMethod(method)
  for (const entry of entries) {
    if (entry.method !== wanted) continue
    const params = matchPattern(entry, pathname)
    if (params !== null) return { ok: true, entryId: entry.id, params }
  }
  return { ok: false }
}

/** THE single shared matcher: the proxy and getPrincipal both use it. */
export function matchPublicApiPath(pathname: string, method: string): AllowlistMatch {
  return _matchAgainst(PUBLIC_API_ALLOWLIST, pathname, method)
}

/** Methods an allowlisted path answers to (any method), for 405 handling. */
export function allowedMethodsForPath(pathname: string): HttpMethod[] {
  const methods: HttpMethod[] = []
  for (const entry of PUBLIC_API_ALLOWLIST) {
    if (!methods.includes(entry.method) && matchPattern(entry, pathname) !== null) methods.push(entry.method)
  }
  return methods
}

/** Value of the Allow header for a path: its entry methods, plus HEAD when GET is present. Empty string when unlisted. */
export function allowHeaderForPath(pathname: string): string {
  const methods: string[] = allowedMethodsForPath(pathname)
  return (methods.includes("GET") ? [...methods, "HEAD"] : methods).join(", ")
}

/** Re-verification against ONE designated entry (getPrincipal step 10): never a free re-match. */
export function matchEntryParams(entry: AllowlistEntry, pathname: string): Record<string, string> | null {
  return matchPattern(entry, pathname)
}

export function matchesEntry(entry: AllowlistEntry, pathname: string, method: string): boolean {
  return entry.method === effectiveMethod(method) && matchPattern(entry, pathname) !== null
}

export function isWriteEntry(entry: AllowlistEntry): boolean {
  return entry.method !== "GET"
}
