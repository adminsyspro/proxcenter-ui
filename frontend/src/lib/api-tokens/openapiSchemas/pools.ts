// Request and response schemas of the pools entries.
const POOLID = { type: "string", description: "Pool id, e.g. prod or prod/web" }
const POOL = { type: "object", properties: { poolid: { type: "string" }, comment: { type: ["string", "null"] } } }

export const POOLS_REQUEST_SCHEMAS: Record<string, Record<string, unknown>> = {
  PoolCreateRequest: { type: "object", required: ["poolid"], properties: { poolid: POOLID, comment: { type: "string" } } },
  PoolUpdateRequest: {
    type: "object",
    required: ["poolid", "comment"],
    properties: { poolid: POOLID, comment: { type: "string", description: "Empty string clears it" } },
  },
}

export const POOLS_RESPONSE_SCHEMAS: Record<string, Record<string, unknown>> = {
  PoolsResponse: {
    type: "object",
    properties: {
      data: { type: "array", items: POOL },
      restricted: { type: "boolean", description: "The list is narrowed to the pools of the caller's guests" },
    },
  },
  PoolWriteResponse: { type: "object", properties: { data: POOL } },
  PoolDeleteResponse: { type: "object", properties: { data: { type: "object", properties: { success: { type: "boolean" } } } } },
}
