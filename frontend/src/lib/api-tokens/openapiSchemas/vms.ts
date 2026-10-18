// Request and response schemas of the VM / container entries (and task status).
import { UPID, STRINGS, taskStarted, dataObject } from "./shared"

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

export const VM_REQUEST_SCHEMAS: Record<string, Record<string, unknown>> = {
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
}

export const VM_RESPONSE_SCHEMAS: Record<string, Record<string, unknown>> = {
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
}
