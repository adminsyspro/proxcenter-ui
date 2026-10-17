// Request and response schemas of the storage entries.
import { STRINGS, taskStarted } from "./shared"

export const STORAGE_REQUEST_SCHEMAS: Record<string, Record<string, unknown>> = {
  StorageAttachPbsRequest: {
    type: "object",
    required: ["storage", "datastore", "pbsConnectionId"],
    properties: {
      type: { type: "string", enum: ["pbs"], description: "Only pbs can be attached; defaults to pbs" },
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
