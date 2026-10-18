// Building blocks shared by the per-domain schema modules.
const TASK_STARTED =
  "A Proxmox task was started. `data` is its UPID; follow it with GET /api/v1/tasks/{connectionId}/{node}/{upid}."
export const UPID = { type: "string", description: "Proxmox task UPID" }
export const STRINGS = { type: "array", items: { type: "string" } }

/** A response whose `data` is the UPID of the task the write started, plus its own fields. */
export function taskStarted(properties: Record<string, unknown>): Record<string, unknown> {
  return { type: "object", description: TASK_STARTED, required: ["data"], properties: { data: UPID, ...properties } }
}

/** `{ data: { ... } }`, the envelope of the /guests/{vmid} routes. */
export function dataObject(properties: Record<string, unknown>): Record<string, unknown> {
  return { type: "object", properties: { data: { type: "object", properties } } }
}
