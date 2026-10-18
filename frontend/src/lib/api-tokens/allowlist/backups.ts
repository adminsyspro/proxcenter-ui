// PURE data modules: imported by BOTH the proxy (D7) and
// principal.ts (D8). NO DB access, ever.
import { CONN, type AllowlistEntry } from "./types"

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

export const BACKUP_ENTRIES: AllowlistEntry[] = [
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
