// Request and response schemas of the HA entries.
import { STRINGS } from "./shared"

const NODES_LIST = { type: "string", description: "Comma-separated nodes, optionally with a priority: node1:2,node2:1" }
const DELETE_LIST = { type: "string", description: "Comma-separated properties to clear" }
const HA_STATE = { type: "string", enum: ["started", "stopped", "enabled", "disabled", "ignored"] }
/** `{ data, message }` of every HA write; `data` is what Proxmox answered (usually null). */
const HA_WRITE = { type: "object", properties: { data: {}, message: { type: "string" } } }
const PVE_OBJECT = { type: "object", description: "As Proxmox returns it", additionalProperties: true }

/** The settings Auto-HA applies to every guest it puts under HA. */
const AUTO_HA_SETTINGS = {
  enabled: { type: "boolean" },
  state: { type: "string", enum: ["started", "stopped", "enabled", "disabled"] },
  group: { type: "string", description: "HA group; empty = none" },
  max_restart: { type: "integer", minimum: 0, maximum: 10 },
  max_relocate: { type: "integer", minimum: 0, maximum: 10 },
  comment: { type: "string" },
}

export const HA_REQUEST_SCHEMAS: Record<string, Record<string, unknown>> = {
  HaResourceUpsertRequest: {
    type: "object",
    description: "Absent fields are not sent to Proxmox: they keep their value on an update and their default on a creation.",
    properties: {
      group: { type: "string", description: "HA group (Proxmox VE 8)" },
      state: HA_STATE,
      max_restart: { type: "integer" },
      max_relocate: { type: "integer" },
      failback: { type: "boolean", description: "Proxmox VE 9 and later" },
      comment: { type: "string" },
    },
  },
  HaGroupCreateRequest: {
    type: "object",
    required: ["group", "nodes"],
    properties: {
      group: { type: "string" },
      nodes: NODES_LIST,
      restricted: { type: "boolean" },
      nofailback: { type: "boolean" },
      comment: { type: "string" },
    },
  },
  HaGroupUpdateRequest: {
    type: "object",
    properties: {
      nodes: NODES_LIST,
      restricted: { type: "boolean" },
      nofailback: { type: "boolean" },
      comment: { type: "string" },
      delete: DELETE_LIST,
    },
  },
  HaAffinityCreateRequest: {
    type: "object",
    required: ["type", "rule"],
    properties: {
      type: { type: "string", enum: ["node-affinity", "resource-affinity"] },
      rule: { type: "string", description: "Rule id" },
      resources: { type: "string", description: "Comma-separated HA resources: vm:100,ct:101" },
      nodes: { ...NODES_LIST, description: `node-affinity only. ${NODES_LIST.description}` },
      strict: { type: "boolean", description: "node-affinity only" },
      affinity: { type: "string", enum: ["positive", "negative"], description: "resource-affinity only: keep together or apart" },
      disable: { type: "boolean" },
      comment: { type: "string" },
    },
  },
  HaAffinityUpdateRequest: {
    type: "object",
    properties: {
      resources: { type: "string" },
      nodes: NODES_LIST,
      strict: { type: "boolean" },
      affinity: { type: "string", enum: ["positive", "negative"] },
      disable: { type: "boolean" },
      comment: { type: "string" },
      delete: DELETE_LIST,
      digest: { type: "string", description: "Digest of the rule as read; refused when it changed since" },
    },
  },
  HaAutoUpdateRequest: { type: "object", properties: AUTO_HA_SETTINGS },
}

export const HA_RESPONSE_SCHEMAS: Record<string, Record<string, unknown>> = {
  HaResourceResponse: { type: "object", properties: { data: { ...PVE_OBJECT, type: ["object", "null"], description: "Null when the guest is not HA-managed" } } },
  HaWriteResponse: HA_WRITE,
  HaListResponse: { type: "object", properties: { data: { type: "array", items: PVE_OBJECT } } },
  HaObjectResponse: { type: "object", properties: { data: PVE_OBJECT } },
  HaAffinityRulesResponse: {
    type: "object",
    properties: {
      data: { type: "array", items: PVE_OBJECT },
      unsupported: { type: "boolean", description: "Present and true on a cluster older than Proxmox VE 9" },
    },
  },
  AutoHaSettingsResponse: { type: "object", properties: { data: { type: "object", properties: AUTO_HA_SETTINGS } } },
  AutoHaSyncResponse: {
    type: "object",
    properties: {
      data: {
        type: "object",
        properties: {
          added: { type: "integer" },
          skipped: { type: "integer", description: "Guests already HA-managed" },
          errors: { ...STRINGS, description: "One `<sid>: <reason>` per guest Proxmox refused" },
        },
      },
    },
  },
}
