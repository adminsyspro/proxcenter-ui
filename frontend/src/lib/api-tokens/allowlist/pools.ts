// PURE data modules: imported by BOTH the proxy (D7) and
// principal.ts (D8). NO DB access, ever.
import { CONN, type AllowlistEntry } from "./types"

// ── Pools domain (spec 5) ────────────────────────────────────────────────────
const POOLS = `${CONN}/pools`
const POOLS_FILE = "src/app/api/v1/connections/[id]/pools/route.ts"
const POOLID_NOTE = "`poolid` starts with a letter and nests up to three levels with `/` (Proxmox VE 8.1 and later)."
/** Every pools entry: one route file, a cluster object. */
const POOL_SHARED = { pattern: POOLS, routeFile: POOLS_FILE, connectionSegment: "id", clusterObject: true, tag: "Pools" } as const

export const POOLS_ENTRIES: AllowlistEntry[] = [
  {
    ...POOL_SHARED,
    id: "pools-list",
    method: "GET",
    requiredScopes: ["nodes:read", "pools:write"],
    summary: "Resource pools of a cluster",
    description: "The Proxmox resource pools of the cluster with their comment.",
    responseSchemaRef: "PoolsResponse",
  },
  {
    ...POOL_SHARED,
    id: "pool-create",
    method: "POST",
    requiredScopes: ["pools:write"],
    summary: "Create a resource pool",
    description: `Creates the pool \`poolid\`. ${POOLID_NOTE} Answers 201. Not available to a vDC tenant token.`,
    requestSchemaRef: "PoolCreateRequest",
    responseSchemaRef: "PoolWriteResponse",
  },
  {
    ...POOL_SHARED,
    id: "pool-update",
    method: "PUT",
    requiredScopes: ["pools:write"],
    summary: "Update the comment of a resource pool",
    description: "Sets the comment of the pool `poolid` (named in the body); an empty comment clears it. Not available to a vDC tenant token.",
    requestSchemaRef: "PoolUpdateRequest",
    responseSchemaRef: "PoolWriteResponse",
  },
  {
    ...POOL_SHARED,
    id: "pool-delete",
    method: "DELETE",
    requiredScopes: ["pools:write"],
    summary: "Delete a resource pool",
    description:
      "Deletes the pool named by the `poolid` query parameter. Proxmox refuses a pool that still has members; a pool backing a vDC answers 409 `POOL_OWNED_BY_VDC`. No body. Not available to a vDC tenant token.",
    queryParams: [{ name: "poolid", description: "The pool to delete", required: true }],
    responseSchemaRef: "PoolDeleteResponse",
  },
]
