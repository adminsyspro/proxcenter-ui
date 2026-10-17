// Request and response schemas of the backup entries.
import { UPID, dataObject } from "./shared"

const PBS_TASK_UPID = { type: "string", description: "PBS task UPID" }
const INT_OR_STRING = { type: ["integer", "string"] }

/** Every field the backup job create and update routes read; on update an absent field is left as is. */
const BACKUP_JOB_FIELDS = {
  storage: { type: "string", description: "Destination storage" },
  namespace: { type: "string", description: "PBS namespace; must be the one the PBS storage carries" },
  schedule: { type: "string", description: "Proxmox calendar event, e.g. 02:00" },
  node: { type: "string", description: "Pin the job to one node (required for a vDC tenant); empty = every node" },
  mode: { type: "string", enum: ["snapshot", "suspend", "stop"] },
  compress: { type: "string", description: "e.g. zstd, lzo, gzip, 0" },
  selectionMode: { type: "string", enum: ["all", "include", "pool"], description: "A vDC tenant must use pool" },
  vmids: { type: "array", items: INT_OR_STRING, description: "selectionMode include" },
  excludedVmids: { type: "array", items: INT_OR_STRING, description: "selectionMode all" },
  pool: { type: "string", description: "selectionMode pool" },
  enabled: { type: "boolean" },
  comment: { type: "string" },
  mailto: { type: "string" },
  mailnotification: { type: "string", enum: ["always", "failure"] },
  notificationMode: { type: "string", enum: ["auto", "legacy-sendmail", "notification-system"] },
  keepAll: { type: "boolean", description: "Keep every backup; the keep* fields are then ignored" },
  keepLast: { type: "integer" },
  keepHourly: { type: "integer" },
  keepDaily: { type: "integer" },
  keepWeekly: { type: "integer" },
  keepMonthly: { type: "integer" },
  keepYearly: { type: "integer" },
  maxfiles: { type: "integer", description: "Legacy retention, translated to keep-last" },
  notesTemplate: { type: "string" },
  bwlimit: INT_OR_STRING,
  zstd: INT_OR_STRING,
  ioWorkers: INT_OR_STRING,
  fleecing: { type: "boolean" },
  fleecingStorage: { type: "string" },
  repeatMissed: { type: "boolean" },
  pbsChangeDetectionMode: { type: "string", enum: ["default", "legacy", "data", "metadata"] },
}

/** Fields shared by every PBS job create and update (ns, comment, max-depth). */
const PBS_JOB_SHARED = {
  ns: { type: "string", description: "Namespace; empty on update = root" },
  comment: { type: "string" },
  maxDepth: { type: "integer" },
}

/** Create and update schemas of one PBS job kind; the job id is set at creation only. */
function pbsJobRequests(kind: string, properties: Record<string, unknown>, required: string[], updateOnly: Record<string, unknown> = {}) {
  return {
    [`Pbs${kind}JobCreateRequest`]: {
      type: "object",
      required: ["id", ...required],
      properties: { id: { type: "string" }, ...properties, ...PBS_JOB_SHARED },
    },
    [`Pbs${kind}JobUpdateRequest`]: {
      type: "object",
      description: "An absent field is left as is; an empty value clears an optional property.",
      properties: { ...properties, ...updateOnly, ...PBS_JOB_SHARED },
    },
  }
}

const PBS_KEEP = {
  keepLast: { type: "integer" },
  keepHourly: { type: "integer" },
  keepDaily: { type: "integer" },
  keepWeekly: { type: "integer" },
  keepMonthly: { type: "integer" },
  keepYearly: { type: "integer" },
}

const GFR_TARGET = {
  type: "object",
  required: ["connId", "node", "type", "vmid"],
  description: "The running guest that receives the files",
  properties: {
    connId: { type: "string", description: "Connection id; must be inside the token perimeter" },
    node: { type: "string" },
    type: { type: "string", enum: ["qemu", "lxc"] },
    vmid: { type: "integer", minimum: 1 },
  },
}

function gfrSsh(fingerprintRequired: boolean) {
  return {
    type: "object",
    required: ["host", "username", ...(fingerprintRequired ? ["hostKeyFingerprint"] : [])],
    description: "SSH method only. A password or a private key is required; used for this request only, never stored.",
    properties: {
      host: { type: "string", description: "One of the guest's own addresses" },
      port: { type: "integer", minimum: 1, maximum: 65535 },
      username: { type: "string" },
      password: { type: "string" },
      privateKey: { type: "string" },
      passphrase: { type: "string" },
      hostKeyFingerprint: { type: "string", pattern: "^SHA256:[A-Za-z0-9+/]{43}$", description: "As reported by the probe" },
    },
  }
}

const GFR_JOB = {
  type: "object",
  properties: {
    id: { type: "string" },
    status: { type: "string", enum: ["queued", "running", "completed", "completed_with_errors", "failed", "cancelled"] },
    method: { type: "string", enum: ["agent", "ssh"] },
    guestOs: { type: ["string", "null"], enum: ["linux", "windows", null] },
    connectionId: { type: "string" },
    node: { type: "string" },
    vmid: { type: "integer" },
    guestType: { type: "string", enum: ["qemu", "lxc"] },
    guestName: { type: ["string", "null"] },
    source: { type: "object" },
    items: { type: "array", items: { type: "object" } },
    destination: { type: "object" },
    conflict: { type: "string", enum: ["keep", "overwrite", "skip"] },
    bytesDone: { type: "integer" },
    bytesRead: { type: "integer" },
    bytesTotal: { type: ["integer", "null"] },
    filesDone: { type: "integer" },
    filesSkipped: { type: "integer" },
    filesFailed: { type: "integer" },
    currentPath: { type: ["string", "null"] },
    error: { type: ["string", "null"] },
    log: { type: "array", items: { type: "object", properties: { at: { type: "string" }, level: { type: "string" }, msg: { type: "string" } } } },
    createdByEmail: { type: ["string", "null"] },
    createdAt: { type: "string" },
    startedAt: { type: ["string", "null"] },
    completedAt: { type: ["string", "null"] },
  },
}

export const BACKUP_REQUEST_SCHEMAS: Record<string, Record<string, unknown>> = {
  BackupJobCreateRequest: {
    type: "object",
    required: ["storage"],
    description: "selectionMode picks the guests: all (minus excludedVmids), include (vmids) or pool (pool).",
    properties: BACKUP_JOB_FIELDS,
  },
  BackupJobUpdateRequest: {
    type: "object",
    description: "Only the fields present change. An empty node, comment or mailto clears it.",
    properties: BACKUP_JOB_FIELDS,
  },
  BackupJobGuestsRequest: {
    type: "object",
    required: ["vmid"],
    properties: { vmid: { ...INT_OR_STRING, description: "Guest to add to the job selection" } },
  },
  VmBackupNowRequest: {
    type: "object",
    required: ["vmid", "storage"],
    properties: {
      vmid: { ...INT_OR_STRING, description: "Guest id, or a comma-separated list of guest ids on {node}" },
      storage: { type: "string", description: "Destination storage" },
      mode: { type: "string", enum: ["snapshot", "suspend", "stop"], default: "snapshot" },
      compress: { type: "string", default: "zstd" },
      notes: { type: "string", description: "Note attached to the backup (Proxmox notes-template)" },
    },
  },
  VmRestoreRequest: {
    type: "object",
    required: ["vmid"],
    description: "One of `archive` or `pbsBackup` is required.",
    properties: {
      vmid: { ...INT_OR_STRING, description: "Id of the restored guest" },
      archive: { type: "string", description: "Proxmox backup volume id, e.g. local:backup/vzdump-qemu-100-....vma.zst" },
      pbsBackup: {
        type: "object",
        required: ["pbsId", "datastore", "backupPath"],
        properties: {
          pbsId: { type: "string", description: "PBS connection id; must be inside the token perimeter" },
          datastore: { type: "string" },
          namespace: { type: "string" },
          backupPath: { type: "string", description: "backup/<type>/<id>/<time>, e.g. backup/vm/100/2026-08-11T15:51:33Z" },
        },
      },
      type: { type: "string", enum: ["qemu", "lxc"], default: "qemu" },
      storage: { type: "string", description: "Target storage of the restored disks" },
      bwlimit: INT_OR_STRING,
      unique: { type: "boolean", description: "Regenerate MAC addresses" },
      start: { type: "boolean", description: "Start the guest once restored" },
      live: { type: "boolean", description: "QEMU only: live restore" },
      force: { type: "boolean", description: "Overwrite the guest holding vmid (needs vm.delete on it)" },
      restoreTags: { type: "boolean", default: true, description: "false restores the guest without its backed-up tags" },
      name: { type: "string" },
      memory: INT_OR_STRING,
      cores: INT_OR_STRING,
      sockets: INT_OR_STRING,
    },
  },
  ...pbsJobRequests("Prune", {
    store: { type: "string", description: "Datastore (`datastore` is accepted on update)" },
    schedule: { type: "string" },
    disable: { type: "boolean" },
    ...PBS_KEEP,
  }, ["store", "schedule"]),
  ...pbsJobRequests("Sync", {
    store: { type: "string", description: "Local datastore" },
    remote: { type: "string" },
    remoteStore: { type: "string" },
    remoteNs: { type: "string" },
    schedule: { type: "string" },
    removeVanished: { type: "boolean" },
  }, ["store", "remote", "remoteStore"], { disable: { type: "boolean" } }),
  ...pbsJobRequests("Verify", {
    store: { type: "string" },
    schedule: { type: "string" },
    ignoreVerified: { type: "boolean" },
    outdatedAfter: { type: "integer", description: "Days" },
  }, ["store"], { disable: { type: "boolean" } }),
  ...pbsJobRequests("Tape", {
    store: { type: "string" },
    pool: { type: "string", description: "Media pool" },
    drive: { type: "string" },
    schedule: { type: "string" },
    notifyUser: { type: "string" },
    ejectMedia: { type: "boolean" },
    exportMediaSet: { type: "boolean" },
    latestOnly: { type: "boolean" },
  }, ["store", "pool", "drive"]),
  GfrProbeRequest: {
    type: "object",
    required: ["target", "method"],
    properties: {
      target: GFR_TARGET,
      method: { type: "string", enum: ["agent", "ssh"], description: "agent: QEMU guest agent (VMs only)" },
      ssh: gfrSsh(false),
    },
  },
  GfrJobCreateRequest: {
    type: "object",
    required: ["source", "items", "target", "method", "destination"],
    properties: {
      source: {
        description: "A PVE backup volume, or a pxar archive of a PBS snapshot",
        oneOf: [
          {
            type: "object",
            required: ["kind", "connId", "storage", "volume"],
            properties: {
              kind: { const: "pve" },
              connId: { type: "string", description: "Must be inside the token perimeter" },
              storage: { type: "string" },
              volume: { type: "string" },
            },
          },
          {
            type: "object",
            required: ["kind", "pbsId", "datastore", "backupType", "backupId", "backupTime", "archive"],
            properties: {
              kind: { const: "pbs" },
              pbsId: { type: "string", description: "Must be inside the token perimeter" },
              datastore: { type: "string" },
              namespace: { type: "string" },
              backupType: { type: "string", enum: ["vm", "ct", "host"] },
              backupId: { type: "string" },
              backupTime: { type: "integer", description: "Epoch seconds" },
              archive: { type: "string", description: "A .pxar.didx archive name" },
            },
          },
        ],
      },
      items: {
        type: "array",
        minItems: 1,
        maxItems: 200,
        items: {
          type: "object",
          required: ["path", "directory"],
          properties: { path: { type: "string", description: "Absolute path inside the backup" }, directory: { type: "boolean" }, size: { type: "integer" } },
        },
      },
      target: GFR_TARGET,
      method: { type: "string", enum: ["agent", "ssh"] },
      destination: {
        type: "object",
        required: ["mode"],
        properties: {
          mode: { type: "string", enum: ["original", "custom"] },
          path: { type: "string", description: "custom mode: guest folder" },
          windowsDrive: { type: "string", pattern: "^[A-Za-z]$" },
        },
      },
      conflict: { type: "string", enum: ["keep", "overwrite", "skip"], description: "Defaults to the setting" },
      ssh: gfrSsh(true),
    },
  },
}

export const BACKUP_RESPONSE_SCHEMAS: Record<string, Record<string, unknown>> = {
  BackupJobsResponse: dataObject({
    jobs: { type: "array", items: { type: "object", description: "Job with its parsed selection, retention and options; `_raw` is the Proxmox job" } },
    storages: { type: "array", items: { type: "object" } },
    allBackupStorages: { type: "array", items: { type: "object" } },
    nodes: { type: "array", items: { type: "object", properties: { node: { type: "string" }, status: { type: "string" }, online: { type: "boolean" } } } },
  }),
  BackupJobResponse: { type: "object", properties: { data: { type: "object", description: "Proxmox backup job", additionalProperties: true } } },
  BackupJobWriteResponse: { type: "object", properties: { data: {}, message: { type: "string" } } },
  BackupJobRunResponse: {
    type: "object",
    properties: {
      data: {
        type: "object",
        properties: {
          tasks: {
            type: "array",
            description: "One vzdump task per node; follow each with GET /api/v1/tasks/{connectionId}/{node}/{upid}",
            items: { type: "object", properties: { node: { type: "string" }, upid: UPID } },
          },
          errors: { type: "array", items: { type: "object", properties: { node: { type: "string" }, error: { type: "string" } } } },
          unresolved: { type: "array", items: { type: "integer" }, description: "Selected guests not found on an online node" },
        },
      },
      message: { type: "string" },
    },
  },
  BackupJobGuestsResponse: dataObject({
    jobId: { type: "string" },
    vmid: { type: "integer" },
    disabled: { type: "boolean", description: "The job is disabled: the guest is covered once it is enabled again" },
  }),
  MessageResponse: { type: "object", properties: { message: { type: "string" } } },
  SuccessResponse: { type: "object", properties: { success: { type: "boolean" } } },
  PbsTaskResponse: { type: "object", required: ["data"], properties: { data: PBS_TASK_UPID, success: { type: "boolean" } } },
  PbsTaskMessageResponse: { type: "object", required: ["data"], properties: { data: PBS_TASK_UPID, message: { type: "string" } } },
  PbsJobConfigResponse: { type: "object", properties: { data: {}, message: { type: "string" } } },
  GfrProbeResponse: {
    type: "object",
    required: ["ok"],
    properties: {
      ok: { type: "boolean" },
      os: { type: "string", enum: ["linux", "windows"] },
      hostname: { type: "string" },
      hostKeyFingerprint: { type: "string", description: "SSH only: confirm it and send it back with the job" },
      details: { type: "object", additionalProperties: { type: "string" } },
      error: { type: "string" },
      errorClass: { type: "string" },
    },
  },
  GfrJobsResponse: { type: "object", properties: { data: { type: "array", items: GFR_JOB } } },
  GfrJobCreatedResponse: {
    type: "object",
    description: "Answered with HTTP 202: the job runs after the response; follow it with GET /api/v1/guest-file-restore/jobs.",
    properties: { data: { type: "object", properties: { id: { type: "string" } } } },
  },
  GfrJobResponse: { type: "object", properties: { data: GFR_JOB } },
}
