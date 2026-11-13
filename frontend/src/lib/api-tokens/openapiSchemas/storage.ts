// Request and response schemas of the storage entries.
import { STRINGS, taskStarted } from "./shared"

const BWLIMIT = {
  type: "object",
  description: "Bandwidth limits in MiB/s; a missing or null kind has no limit",
  properties: Object.fromEntries(["default", "migration", "restore", "clone", "move"].map(k => [k, { type: ["number", "null"] }])),
}

const CLUSTER_STORAGE_COMMON = {
  fields: {
    type: "object",
    additionalProperties: true,
    description:
      "Type fields by Proxmox key. nfs: server, export, options. cifs: server, share, username, password, domain, smbversion, subdir. iscsi: portal, target. lvm: vgname, base, saferemove. rbd: monhost, pool, username, keyring, krbd. cephfs: monhost, username, keyring (the client key), fs-name. zfs: portal, pool, target, iscsiprovider, lio_tpg, blocksize, sparse, nowritecache. dir: path, is_mountpoint. Secrets are never returned.",
  },
  content: { ...STRINGS, description: "Allowed contents for this type (iscsi: images to use the LUNs directly, or none)" },
  nodes: { ...STRINGS, description: "Nodes allowed to use the storage; empty = every node" },
  enabled: { type: "boolean" },
  shared: { type: "boolean", description: "dir and lvm only" },
  bwlimit: BWLIMIT,
}

export const STORAGE_REQUEST_SCHEMAS: Record<string, Record<string, unknown>> = {
  StorageCreateRequest: {
    description: "A PBS datastore (StorageAttachPbsRequest) or one of the cluster storage types below.",
    oneOf: [
      { $ref: "#/components/schemas/StorageAttachPbsRequest" },
      {
        type: "object",
        required: ["type", "storage", "fields", "content"],
        properties: {
          type: { type: "string", enum: ["nfs", "cifs", "iscsi", "lvm", "rbd", "cephfs", "zfs", "dir"] },
          storage: { type: "string", description: "Name of the new PVE storage" },
          ...CLUSTER_STORAGE_COMMON,
        },
      },
    ],
  },
  StorageUpdateRequest: {
    type: "object",
    required: ["content"],
    description: "Fields Proxmox fixes at creation are ignored; a blank secret keeps the stored one; an emptied optional field is cleared.",
    properties: CLUSTER_STORAGE_COMMON,
  },
  StorageScanRequest: {
    type: "object",
    required: ["type"],
    properties: {
      type: { type: "string", enum: ["nfs", "cifs", "iscsi", "lvm"] },
      server: { type: "string", description: "nfs, cifs" },
      username: { type: "string", description: "cifs" },
      password: { type: "string", description: "cifs" },
      domain: { type: "string", description: "cifs" },
      portal: { type: "string", description: "iscsi" },
    },
  },
  StorageAttachPbsRequest: {
    type: "object",
    required: ["storage", "datastore", "pbsConnectionId"],
    properties: {
      type: { type: "string", enum: ["pbs"], description: "pbs (the default); see StorageCreateRequest for the other types" },
      storage: { type: "string", description: "Name of the new PVE storage" },
      datastore: { type: "string", description: "Datastore of the PBS" },
      namespace: { type: "string", description: "PBS namespace, created when missing; empty = root" },
      nodes: { ...STRINGS, description: "Nodes allowed to use the storage; empty = every node" },
      pbsConnectionId: { type: "string", description: "PBS connection id; must be inside the token perimeter" },
    },
  },
  StorageDownloadUrlRequest: {
    type: "object",
    required: ["url", "content", "filename"],
    properties: {
      url: { type: "string", description: "Source URL, fetched by the node" },
      content: { type: "string", description: "Content type of the file, e.g. iso, vztmpl, import" },
      filename: { type: "string", description: "Target file name on the storage" },
    },
  },
  AplinfoDownloadRequest: {
    type: "object",
    required: ["storage", "template"],
    properties: {
      storage: { type: "string", description: "Storage that receives the template" },
      template: { type: "string", description: "Template name, as listed by GET aplinfo" },
    },
  },
}

export const STORAGE_RESPONSE_SCHEMAS: Record<string, Record<string, unknown>> = {
  ConnectionStoragesResponse: {
    type: "object",
    properties: {
      data: {
        type: "array",
        items: {
          type: "object",
          description: "Shared storages first, then by usage",
          properties: {
            id: { type: "string" },
            storage: { type: "string" },
            node: { type: "string" },
            nodes: STRINGS,
            type: { type: "string" },
            status: { type: "string" },
            enabled: { type: "boolean" },
            shared: { type: "boolean" },
            content: STRINGS,
            used: { type: "integer" },
            total: { type: "integer" },
            free: { type: "integer" },
            usedPct: { type: "number" },
            formats: { ...STRINGS, description: "Disk formats a VM disk may use on it" },
            defaultFormat: { type: "string" },
          },
          additionalProperties: true,
        },
      },
    },
  },
  StorageAttachPbsResponse: {
    type: "object",
    description: "Answered with HTTP 201.",
    properties: {
      data: {
        type: "object",
        properties: {
          storage: { type: "string" },
          server: { type: "string" },
          datastore: { type: "string" },
          namespace: { type: "string" },
          nodes: STRINGS,
          credentials: { type: "string", enum: ["scoped-token"] },
          tokenId: { type: "string", description: "The PBS token the cluster holds" },
          steps: { type: "object", additionalProperties: { type: "string" } },
        },
      },
    },
  },
  StorageCreateResponse: {
    description: "Answered with HTTP 201: the PBS attach result, or the new storage and its type.",
    oneOf: [
      { $ref: "#/components/schemas/StorageAttachPbsResponse" },
      { type: "object", properties: { data: { type: "object", properties: { storage: { type: "string" }, type: { type: "string" } } } } },
    ],
  },
  StorageConfigResponse: {
    type: "object",
    properties: { data: { type: "object", additionalProperties: true, description: "storage.cfg entry, secrets left out" } },
  },
  StorageUpdateResponse: {
    type: "object",
    properties: { data: { type: "object", properties: { storage: { type: "string" }, type: { type: "string" } } } },
  },
  StorageScanResponse: {
    type: "object",
    properties: {
      data: {
        type: "array",
        items: { type: "object", properties: { value: { type: "string" }, detail: { type: ["string", "null"] } } },
        description: "nfs: export paths, cifs: shares, iscsi: targets, lvm: volume groups",
      },
    },
  },
  StorageDetachResponse: {
    type: "object",
    properties: {
      data: {
        type: "object",
        properties: {
          storage: { type: "string" },
          token: { type: "string", enum: ["revoked", "kept-in-use", "kept-unmanaged", "kept-unknown-pbs", "revoke-failed"] },
          tokenId: { type: "string" },
          usedBy: { ...STRINGS, description: "kept-in-use: the clusters still using the token" },
          removed: { type: "boolean", description: "Any other type: the storage was removed from storage.cfg" },
        },
      },
    },
  },
  StorageTaskResponse: taskStarted({ success: { type: "boolean" } }),
  AplinfoResponse: {
    type: "object",
    properties: { data: { type: "array", items: { type: "object", description: "Proxmox template entry (template, package, os, version, headline...)", additionalProperties: true } } },
  },
}
