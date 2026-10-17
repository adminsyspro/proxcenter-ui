// Response schemas maintained NEXT TO the allowlist entries: the allowlist is
// not reducible to a pattern plus scopes (spec D8), the generator builds the
// spec skeleton from these metadata.
const TASK_STARTED =
  "A Proxmox task was started. `data` is its UPID; follow it with GET /api/v1/tasks/{connectionId}/{node}/{upid}."
const UPID = { type: "string", description: "Proxmox task UPID" }
const STRINGS = { type: "array", items: { type: "string" } }

/** A response whose `data` is the UPID of the task the write started, plus its own fields. */
function taskStarted(properties: Record<string, unknown>): Record<string, unknown> {
  return { type: "object", description: TASK_STARTED, required: ["data"], properties: { data: UPID, ...properties } }
}

/** `{ data: { ... } }`, the envelope of the /guests/{vmid} routes. */
function dataObject(properties: Record<string, unknown>): Record<string, unknown> {
  return { type: "object", properties: { data: { type: "object", properties } } }
}

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

const HA_CAPTURE = {
  type: ["object", "null"],
  properties: {
    sid: { type: "string" },
    state: { type: "string" },
    group: { type: "string" },
    comment: { type: "string" },
    maxRestart: { type: "number" },
    maxRelocate: { type: "number" },
    failback: { type: "number" },
    autoRebalance: { type: "number" },
  },
}

const REPLICATION_CAPTURE = {
  type: "array",
  items: {
    type: "object",
    properties: {
      id: { type: "string" },
      guest: { type: "integer" },
      target: { type: "string" },
      schedule: { type: "string" },
      rate: { type: "number" },
      comment: { type: "string" },
      disable: { type: "number" },
    },
  },
}

const PREREQ_CAPTURE = {
  type: "object",
  description: "Prerequisites removed from the source guest, as captured before removal.",
  properties: { ha: HA_CAPTURE, replication: REPLICATION_CAPTURE, snapshotsDeleted: STRINGS },
}

// Request body schemas, keyed by AllowlistEntry.requestSchemaRef. Naming
// convention: <PascalEntryId>Request. Each lists the fields its handler reads.
export const REQUEST_SCHEMAS: Record<string, Record<string, unknown>> = {
  VmCreateRequest: {
    type: "object",
    description:
      "Proxmox create parameters (qm create for qemu, pct create for lxc), forwarded as JSON once the vDC rules have run. A vDC tenant gets its pool and CPU model applied when absent.",
    required: ["vmid"],
    properties: {
      vmid: { type: ["integer", "string"], description: "New guest id" },
      pool: { type: "string", description: "Resource pool; required for a caller scoped to several pools" },
      name: { type: "string" },
      cores: { type: ["integer", "string"] },
      sockets: { type: ["integer", "string"] },
      memory: { type: ["integer", "string"], description: "MiB" },
      cpu: { type: "string" },
      nameserver: { type: "string" },
    },
    additionalProperties: true,
  },
  VmConfigUpdateRequest: {
    type: "object",
    description:
      "Proxmox configuration keys to write. QEMU: name, description, tags, onboot, protection, startup, cores, sockets, cpu, vcpus, cpulimit, cpuunits, numa, memory, balloon, shares, boot, bootdisk, bios, machine, agent, scsihw, vga, ostype, hotplug, tablet, localtime, freeze, kvm, acpi, args, cloud-init keys, netN, scsiN/virtioN/ideN/sataN, unusedN, hostpciN, usbN, ipconfigN, efidiskN, tpmstateN, serialN, audioN, rng0. LXC: hostname, description, tags, onboot, protection, startup, cores, cpulimit, cpuunits, memory, swap, unprivileged, features, netN, unusedN. Other keys are dropped.",
    properties: {
      delete: { type: "string", description: "Comma-separated keys to remove" },
      revert: { type: "string", description: "Comma-separated pending changes to undo" },
      digest: { type: "string", description: "Config digest the change was prepared on; required to stay current when an optical drive changes" },
    },
    additionalProperties: true,
  },
  VmCloneRequest: {
    type: "object",
    description: "Other Proxmox clone parameters pass through.",
    required: ["newid"],
    properties: {
      newid: { type: ["integer", "string"], minimum: 100, description: "Id of the clone" },
      name: { type: "string" },
      description: { type: "string" },
      pool: { type: "string" },
      snapname: { type: "string" },
      storage: { type: "string" },
      format: { type: "string", enum: ["raw", "qcow2", "vmdk"] },
      full: { type: ["boolean", "number"] },
      target: { type: "string", description: "Target node" },
    },
    additionalProperties: true,
  },
  VmDiskResizeRequest: {
    type: "object",
    required: ["disk", "size"],
    properties: {
      disk: { type: "string", minLength: 1, description: "Disk key, e.g. scsi0" },
      size: { type: "string", minLength: 1, description: "New size or growth, e.g. +10G" },
    },
  },
  VmDiskMoveRequest: {
    type: "object",
    required: ["disk", "storage"],
    properties: {
      disk: { type: "string", minLength: 1, description: "Disk key, e.g. scsi0" },
      storage: { type: "string", minLength: 1, description: "Target storage" },
      deleteSource: { type: "boolean", default: true },
      format: { type: "string" },
    },
  },
  VmMigrateRequest: {
    type: "object",
    required: ["target"],
    properties: {
      target: { type: "string", minLength: 1, description: "Target node" },
      online: { type: "boolean", default: true },
      targetstorage: { type: "string" },
      withLocalDisks: { type: "boolean" },
    },
  },
  VmRemoteMigrateRequest: {
    type: "object",
    required: ["targetConnectionId", "targetNode", "targetStorage", "targetBridge"],
    properties: {
      targetConnectionId: { type: "string", description: "Target connection id; must be inside the token perimeter" },
      targetNode: { type: "string" },
      targetVmid: { type: ["integer", "string"], description: "Defaults to the source vmid" },
      targetStorage: { type: "string" },
      targetBridge: { type: "string" },
      online: { type: "boolean", default: true },
      delete: { type: "boolean", default: false, description: "Delete the source VM once the migration succeeded" },
      bwlimit: { type: "number", description: "KiB/s" },
      restore: {
        type: "object",
        description: "Replay of the prerequisites cleared by remote-migrate/prepare once the VM landed. Ignored when malformed.",
        required: ["capture"],
        properties: {
          capture: PREREQ_CAPTURE,
          restoreHa: { type: "boolean" },
          haState: { type: "string" },
          restoreReplication: { type: "boolean" },
          replicationTarget: { type: "string" },
          replicationSchedule: { type: "string" },
          replicationRate: { type: "number" },
          rollbackOnFailure: { type: "boolean", description: "Put the capture back on the source if the migration fails" },
        },
      },
    },
  },
  VmRemoteMigrateCheckRequest: {
    type: "object",
    required: ["targetConnectionId", "targetNode", "targetStorage", "targetBridge"],
    properties: {
      targetConnectionId: { type: "string", description: "Target connection id; must be inside the token perimeter" },
      targetNode: { type: "string" },
      targetStorage: { type: "string" },
      targetBridge: { type: "string" },
    },
  },
  VmRemoteMigratePrepareRequest: {
    type: "object",
    properties: {
      removeHa: { type: "boolean", default: false },
      removeReplication: { type: "boolean", default: false },
      removeSnapshots: { type: "array", items: { type: "string", minLength: 1 }, description: "Snapshot names; irreversible" },
    },
  },
  VmNotesUpdateRequest: {
    type: "object",
    required: ["content"],
    properties: { content: { type: "string" } },
  },
  VmSnapshotCreateRequest: {
    type: "object",
    required: ["name"],
    properties: {
      name: { type: "string", pattern: "^[a-zA-Z0-9_-]+$" },
      description: { type: "string" },
      vmstate: { type: "boolean", description: "QEMU only: also save the RAM" },
    },
  },
  VmSnapshotUpdateRequest: {
    type: "object",
    properties: { description: { type: "string" } },
  },
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

export const RESPONSE_SCHEMAS: Record<string, Record<string, unknown>> = {
  VmsResponse: {
    type: "object",
    properties: {
      data: {
        type: "object",
        properties: {
          vms: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                connId: { type: "string" },
                connectionName: { type: "string" },
                node: { type: "string" },
                vmid: { type: "string" },
                name: { type: "string" },
                type: { type: "string", enum: ["qemu", "lxc"] },
                status: { type: "string" },
                cpu: { type: "number" },
                ram: { type: "number" },
                cpuType: { type: ["string", "null"] },
                scsihw: { type: ["string", "null"] },
                agentEnabled: { type: "boolean" },
                bios: { type: ["string", "null"] },
                ostype: { type: ["string", "null"] },
                onboot: { type: "boolean" },
                description: { type: ["string", "null"] },
                macs: { type: "array", items: { type: "string" } },
                ips: { type: "array", items: { type: "string" } },
                staleIps: { type: "array", items: { type: "string" } },
                agentResponding: { type: "boolean" },
                agentOsName: { type: ["string", "null"] },
              },
            },
          },
          stats: { type: "object", additionalProperties: { type: "number" } },
          ipIndexWarming: { type: "boolean" },
        },
      },
    },
  },
  InventoryResponse: {
    type: "object",
    properties: {
      data: {
        type: "object",
        properties: {
          clusters: { type: "array", items: { type: "object" } },
          pbsServers: { type: "array", items: { type: "object" } },
          externalHypervisors: { type: "array", items: { type: "object" } },
          cached: { type: "boolean" },
          stats: { type: "object", additionalProperties: { type: "number" } },
        },
      },
    },
  },
  StorageResponse: {
    type: "object",
    properties: {
      data: { type: "array", items: { type: "object" } },
      connections: { type: "array", items: { type: "object" } },
    },
  },
  PbsBackupsResponse: {
    type: "object",
    properties: {
      data: { type: "array", items: { type: "object" } },
      warnings: { type: "array", items: { type: "string" } },
    },
  },
  PublicBackupsResponse: {
    type: "object",
    properties: {
      data: {
        type: "object",
        properties: {
          guests: {
            type: "array",
            items: {
              type: "object",
              properties: {
                connId: { type: "string" },
                connectionName: { type: "string" },
                vmid: { type: "string" },
                backupType: { type: "string", enum: ["vm", "ct", "host"] },
                latestBackupTime: { type: ["integer", "null"] },
                latestBackupIso: { type: ["string", "null"] },
                ageSeconds: { type: ["integer", "null"] },
                datastore: { type: ["string", "null"] },
                namespace: { type: ["string", "null"] },
                pbsConnectionId: { type: ["string", "null"] },
                pbsConnectionName: { type: ["string", "null"] },
                sizeBytes: { type: ["integer", "null"] },
                verified: { type: ["boolean", "null"] },
              },
            },
          },
          warnings: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
  HealthResponse: {
    type: "object",
    properties: {
      data: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["ok", "degraded"] },
          tenantId: { type: "string" },
          cached: { type: "boolean" },
          connections: {
            type: "array",
            items: {
              type: "object",
              properties: {
                connId: { type: "string" },
                name: { type: "string" },
                reachable: { type: "boolean" },
                nodesOnline: { type: "integer" },
                nodesTotal: { type: "integer" },
              },
            },
          },
        },
      },
    },
  },
  TaskStartedResponse: taskStarted({}),
  VmCreateResponse: taskStarted({ message: { type: "string" }, allocatedIps: STRINGS }),
  VmPowerResponse: taskStarted({ node: { type: "string" }, connId: { type: "string" }, message: { type: "string" } }),
  VmTaskMessageResponse: taskStarted({ message: { type: "string" } }),
  VmSuccessTaskResponse: taskStarted({ success: { type: "boolean" }, message: { type: "string" } }),
  VmDeleteResponse: taskStarted({
    success: { type: "boolean" },
    message: { type: "string" },
    warning: { type: "string", description: "Present when the IPAM addresses could not be released" },
  }),
  VmRemoteMigrateResponse: taskStarted({
    success: { type: "boolean" },
    message: { type: "string" },
    details: {
      type: "object",
      properties: {
        sourceCluster: { type: "string" },
        targetCluster: { type: "string" },
        targetNode: { type: "string" },
        targetStorage: { type: "string" },
        targetBridge: { type: "string" },
        online: { type: "boolean" },
        deleteSource: { type: "boolean" },
      },
    },
  }),
  VmConfigUpdateResponse: {
    type: "object",
    description:
      "200 once Proxmox applied the change. 202 with `pending: true` when its task outlived the request: follow `upid` on `node` with GET /api/v1/tasks/{connectionId}/{node}/{upid}.",
    properties: {
      data: { type: ["string", "null"], description: "Proxmox task UPID, null when Proxmox ran no task" },
      success: { type: "boolean" },
      pending: { type: "boolean" },
      upid: { type: "string" },
      node: { type: "string" },
    },
  },
  VmConfigResponse: {
    type: "object",
    properties: {
      data: {
        type: "object",
        description: "Effective Proxmox configuration keys",
        properties: { pending: { type: "object", description: "Changes waiting for a reboot", additionalProperties: true } },
        additionalProperties: true,
      },
      movedTo: { type: ["string", "null"], description: "Current node when the guest left the URL node" },
    },
  },
  VmLockStateResponse: dataObject({ locked: { type: "boolean" }, lockType: { type: ["string", "null"] } }),
  VmUnlockResponse: {
    type: "object",
    properties: {
      data: {
        type: "object",
        properties: {
          unlocked: { type: "boolean" },
          reason: { type: "string", enum: ["not_locked"] },
          previousLock: { type: "string" },
          method: { type: "string", enum: ["ssh"] },
          output: { type: "string" },
        },
      },
      message: { type: "string" },
    },
  },
  VmRemoteMigrateCheckResponse: {
    type: "object",
    properties: {
      valid: { type: "boolean" },
      issues: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["error", "warning"] },
            code: { type: "string" },
            message: { type: "string" },
            details: { type: "string" },
            context: { type: "object", additionalProperties: { type: ["string", "number"] } },
            remediation: { type: "object", description: "Present when remote-migrate/prepare can clear this blocker" },
            siteRecovery: { type: "object" },
          },
        },
      },
      summary: { type: "object", properties: { errors: { type: "integer" }, warnings: { type: "integer" } } },
    },
  },
  VmMigratePrerequisitesResponse: {
    type: "object",
    properties: {
      ha: HA_CAPTURE,
      replication: REPLICATION_CAPTURE,
      snapshots: STRINGS,
      siteRecoveryJobs: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            otherVmids: { type: "array", items: { type: "integer" } },
            byTag: { type: "boolean" },
          },
        },
      },
    },
  },
  VmRemoteMigratePrepareResponse: {
    type: "object",
    properties: {
      success: { type: "boolean" },
      capture: PREREQ_CAPTURE,
      cleared: {
        type: "object",
        properties: { ha: { type: "boolean" }, replicationJobs: STRINGS, snapshots: STRINGS },
      },
      pending: { type: "object", properties: { replicationJobs: STRINGS } },
      warnings: STRINGS,
    },
  },
  VmNotesResponse: dataObject({ content: { type: "string" } }),
  VmNotesUpdateResponse: dataObject({ success: { type: "boolean" }, content: { type: "string" } }),
  VmSnapshotsResponse: dataObject({
    snapshots: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          snaptime: { type: "integer", description: "Epoch seconds" },
          vmstate: { type: ["boolean", "integer"] },
          parent: { type: ["string", "null"] },
        },
      },
    },
    count: { type: "integer" },
  }),
  VmSnapshotTaskResponse: dataObject({
    success: { type: "boolean" },
    upid: { ...UPID, description: "Proxmox task UPID; follow it with GET /api/v1/tasks/{connectionId}/{node}/{upid}" },
    message: { type: "string" },
  }),
  VmSnapshotUpdateResponse: dataObject({ success: { type: "boolean" }, message: { type: "string" } }),
  VmTasksResponse: dataObject({
    tasks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          upid: { type: "string" },
          type: { type: "string" },
          status: { type: "string", enum: ["running", "success", "warning", "error"] },
          statusText: { type: ["string", "null"] },
          starttime: { type: "integer" },
          endtime: { type: ["integer", "null"] },
          duration: { type: ["integer", "null"] },
          durationFormatted: { type: ["string", "null"] },
          user: { type: "string" },
          node: { type: "string" },
        },
      },
    },
    count: { type: "integer" },
  }),
  TaskStatusResponse: {
    type: "object",
    properties: {
      upid: { type: "string" },
      node: { type: "string" },
      type: { type: ["string", "null"] },
      id: { type: ["string", "null"], description: "Task object id, the vmid for guest tasks" },
      user: { type: ["string", "null"] },
      status: { type: "string", description: "`running` or `stopped`" },
      exitstatus: { type: ["string", "null"], description: "`OK` on success" },
      failureReason: { type: ["string", "null"] },
      starttime: { type: ["integer", "null"] },
      endtime: { type: ["integer", "null"] },
      duration: { type: "string" },
      durationSec: { type: "integer" },
      progress: { type: "number" },
      message: { type: "string" },
      speed: { type: "string" },
      eta: { type: "string" },
      totalLogLines: { type: "integer" },
      logs: {
        type: "array",
        items: { type: "object", properties: { n: { type: "integer" }, t: { type: "string" } } },
      },
    },
  },
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
  PrometheusExposition: {
    type: "string",
    description: "Prometheus text exposition format (version 0.0.4).",
  },
}
