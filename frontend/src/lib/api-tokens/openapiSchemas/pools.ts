// Request and response schemas of the pools entries.
const POOLID = { type: "string", description: "Pool id, e.g. prod or prod/web" }
const POOL = { type: "object", properties: { poolid: { type: "string" }, comment: { type: ["string", "null"] } } }

export const POOLS_REQUEST_SCHEMAS: Record<string, Record<string, unknown>> = {
  PoolCreateRequest: { type: "object", required: ["poolid"], properties: { poolid: POOLID, comment: { type: "string" } } },
  PoolUpdateRequest: {
    type: "object",
    required: ["poolid"],
    properties: {
      poolid: POOLID,
      comment: { type: "string", description: "Empty string clears it. Required when neither vms nor storage is given" },
      vms: { type: "array", items: { type: "integer" }, description: "Guests to add, or to remove with delete" },
      storage: { type: "array", items: { type: "string" }, description: "Storages to add, or to remove with delete" },
      delete: { type: "boolean", description: "Remove vms and storage from the pool instead of adding them" },
      allowMove: { type: "boolean", description: "Move a guest that belongs to another pool" },
    },
  },
}

const POOL_MEMBERS = {
  type: "object",
  properties: {
    poolid: { type: "string" },
    comment: { type: ["string", "null"] },
    guests: {
      type: "array",
      items: {
        type: "object",
        properties: {
          vmid: { type: "integer" },
          type: { type: "string", enum: ["qemu", "lxc"] },
          node: { type: "string" },
          name: { type: ["string", "null"] },
          status: { type: ["string", "null"] },
          template: { type: "boolean" },
        },
      },
    },
    storages: {
      type: "array",
      items: {
        type: "object",
        properties: {
          storage: { type: "string" },
          type: { type: ["string", "null"] },
          shared: { type: "boolean" },
          nodes: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
}

export const POOLS_RESPONSE_SCHEMAS: Record<string, Record<string, unknown>> = {
  PoolsResponse: {
    type: "object",
    properties: {
      data: { oneOf: [{ type: "array", items: POOL }, POOL_MEMBERS], description: "The pools, or with `poolid` that pool and its members" },
      restricted: { type: "boolean", description: "The list is narrowed to the pools of the caller's guests" },
    },
  },
  PoolWriteResponse: {
    type: "object",
    properties: {
      data: {
        oneOf: [
          POOL,
          {
            type: "object",
            properties: {
              poolid: { type: "string" },
              vms: { type: "array", items: { type: "integer" } },
              storage: { type: "array", items: { type: "string" } },
              delete: { type: "boolean" },
            },
          },
        ],
      },
    },
  },
  PoolDeleteResponse: { type: "object", properties: { data: { type: "object", properties: { success: { type: "boolean" } } } } },
}
