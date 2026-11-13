// Request and response schemas of the multi-tenant write entries (issue #1360,
// lot 2): vDC lifecycle, GPU quota, storage policies and shared EVPN zones.
// The vDC body stays open where the UI sends richer objects than a client
// needs (transport, compute policy): the server validates them.
import { STRINGS } from "./shared"
import { EVPN_ZONE, QUOTA, STORAGE_POLICY, VDC } from "./tenancy"

const OPEN_OBJECT = { type: "object", additionalProperties: true }
const OPEN_LIST = { type: "array", items: OPEN_OBJECT }
const NULLABLE_INT = { type: ["integer", "null"] }

const VDC_SETTINGS = {
  name: { type: "string" },
  description: { type: ["string", "null"] },
  nodes: { ...STRINGS, description: "Proxmox nodes the vDC may run guests on; not empty" },
  primaryStorage: { type: "string", description: "A shared storage of the cluster advertising content=images" },
  sharedBridges: { ...OPEN_LIST, description: "Uplink bridges the vDC may attach guests to" },
  vlanPools: { ...OPEN_LIST, description: "VLAN ranges a VLAN network of the vDC is taken from" },
  storagePolicies: { ...OPEN_LIST, description: "Storage policies of the vDC connection, by policyId" },
  computePolicy: { ...OPEN_OBJECT, description: "CPU types and limits offered to the vDC" },
  allowBlankVms: { type: "boolean" },
  isoLibraries: { ...OPEN_LIST, description: "ISO storages the vDC may mount" },
  catalogGrants: { type: "object", properties: { imageIds: STRINGS, blueprintIds: STRINGS } },
  transport: { ...OPEN_OBJECT, description: "VNet transport: cluster, VLAN or VXLAN peers" },
  edgeModel: { type: "string" },
  quota: QUOTA,
}

const EVPN_CONTROLLER = {
  type: "object",
  required: ["mode", "name"],
  description: "An EVPN controller of the cluster, or one to create",
  properties: {
    mode: { type: "string", enum: ["existing", "create"] },
    name: { type: "string" },
    asn: { type: "integer", description: "create only" },
    peers: { ...STRINGS, description: "create only: the BGP peers" },
  },
}
const EVPN_MEMBER_INPUT = {
  type: "object",
  required: ["connectionId", "controller"],
  properties: { connectionId: { type: "string" }, controller: EVPN_CONTROLLER },
}
const APPLY_ERRORS = {
  type: "array",
  description: "Clusters where the SDN configuration could not be applied; the declaration is kept",
  items: { type: "object", properties: { connectionName: { type: "string" }, error: { type: "string" } } },
}
const GPU_ENTRY_INPUT = {
  type: "object",
  required: ["kind", "modelKey", "modelName", "profileName", "count"],
  properties: {
    kind: { type: "string", enum: ["vgpu", "whole"] },
    modelKey: { type: "string" },
    modelName: { type: "string" },
    profileName: { type: "string", description: "The vGPU profile without the vendor prefix; empty for a whole card" },
    count: { type: "integer", minimum: 1 },
  },
}
const STORAGE_POLICY_INPUT = {
  name: { type: "string" },
  description: { type: ["string", "null"] },
  storageId: { type: "string", description: "A shared storage of the connection" },
  iopsRd: NULLABLE_INT,
  iopsWr: NULLABLE_INT,
  mbpsRd: NULLABLE_INT,
  mbpsWr: NULLABLE_INT,
}

export const TENANCY_WRITE_REQUEST_SCHEMAS: Record<string, Record<string, unknown>> = {
  AdminVdcCreateRequest: {
    type: "object",
    required: ["tenantId", "connectionId", "name", "slug", "nodes", "primaryStorage"],
    properties: {
      tenantId: { type: "string" },
      connectionId: { type: "string", description: "The provider cluster the vDC lives on" },
      slug: { type: "string", pattern: "^[a-z0-9-]+$" },
      ...VDC_SETTINGS,
      sdnZoneName: { type: "string" },
      evpnZoneId: { type: ["string", "null"], description: "Shared EVPN zone to attach the vDC to" },
      ownVxlanZone: { type: "boolean", description: "false with evpnZoneId: no zone of its own" },
    },
  },
  AdminVdcUpdateRequest: {
    type: "object",
    description: "Only the given fields change.",
    properties: {
      ...VDC_SETTINGS,
      enabled: { type: "boolean" },
      evpnZoneId: { type: ["string", "null"], description: "An id attaches, null or empty detaches" },
    },
  },
  VdcGpuQuotaUpdateRequest: {
    type: "object",
    required: ["entries"],
    description: "Replaces the whole GPU contingent; a line under what the vDC holds is kept and flagged overCommitted",
    properties: { entries: { type: "array", items: GPU_ENTRY_INPUT } },
  },
  StoragePolicyCreateRequest: { type: "object", required: ["name", "storageId"], properties: STORAGE_POLICY_INPUT },
  StoragePolicyUpdateRequest: { type: "object", required: ["name", "storageId"], properties: STORAGE_POLICY_INPUT },
  EvpnZoneCreateRequest: {
    type: "object",
    required: ["name", "zoneName", "vrfVxlan", "vniStart", "vniEnd", "members"],
    properties: {
      name: { type: "string" },
      description: { type: ["string", "null"] },
      zoneName: { type: "string", pattern: "^[a-z][a-z0-9]{1,7}$", description: "Name of the zone in Proxmox" },
      vrfVxlan: { type: "integer" },
      mtu: NULLABLE_INT,
      vniStart: { type: "integer" },
      vniEnd: { type: "integer" },
      members: { type: "array", items: EVPN_MEMBER_INPUT },
    },
  },
  EvpnZoneUpdateRequest: {
    type: "object",
    description: "Only the given fields change; the VNI range is checked against every cluster only when it moves.",
    properties: {
      name: { type: "string" },
      description: { type: ["string", "null"] },
      vniStart: { type: "integer" },
      vniEnd: { type: "integer" },
    },
  },
  EvpnZoneMemberAddRequest: EVPN_MEMBER_INPUT,
  VdcEvpnNetworkUpdateRequest: {
    type: "object",
    required: ["vdcIds"],
    properties: { vdcIds: { ...STRINGS, description: "Every vDC of the tenant that must carry the network; at least one" } },
  },
}

export const TENANCY_WRITE_RESPONSE_SCHEMAS: Record<string, Record<string, unknown>> = {
  VdcWriteResponse: { type: "object", properties: { data: VDC } },
  VdcDeleteResponse: { type: "object", properties: { data: { type: "object", properties: { success: { type: "boolean" } } } } },
  VdcGpuQuotaResponse: {
    type: "object",
    properties: {
      data: {
        type: "object",
        properties: {
          entries: {
            type: "array",
            items: {
              type: "object",
              properties: {
                ...GPU_ENTRY_INPUT.properties,
                id: { type: "string" },
                held: { type: "integer", description: "Server computed: what the vDC guests hold" },
                overCommitted: { type: "boolean", description: "Server computed: held above count" },
              },
            },
          },
          offers: { ...OPEN_LIST, description: "What the vDC cluster can offer, per card model and profile" },
          capacity: { ...OPEN_LIST, description: "What each card model of the cluster adds up to" },
          readable: { type: "boolean", description: "False when the cluster could not be read: offers, capacity and held are then unknown" },
        },
      },
    },
  },
  StoragePolicyResponse: { type: "object", properties: { data: STORAGE_POLICY } },
  EvpnZoneWriteResponse: { type: "object", properties: { data: EVPN_ZONE, applyErrors: APPLY_ERRORS } },
  EvpnZoneDeleteResponse: {
    type: "object",
    properties: { data: { type: "object", properties: { success: { type: "boolean" } } }, applyErrors: APPLY_ERRORS },
  },
  VdcEvpnNetworkPresenceResponse: { type: "object", properties: { data: { type: "object", properties: { vdcIds: STRINGS } } } },
}
