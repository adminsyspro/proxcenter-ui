// PURE data modules: imported by BOTH the proxy (D7) and
// principal.ts (D8). NO DB access, ever.

export type AllowlistQueryParam = {
  name: string
  description: string
  required?: boolean
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

export type ApiTag =
  | "Monitoring" | "VMs" | "Snapshots" | "Backups" | "Storage"
  | "HA" | "Pools" | "Network" | "Firewall" | "Tasks"

export type BodyOrQueryField = { source: "body" | "query"; field: string }

export type GuestScopeSpec =
  // Path segment names. allowMovedNode: the guest may have left the URL node
  // for another node of the vDC (mirrors the handler's own check).
  | { connection: string; node: string; type: string; vmid: string; allowMovedNode?: true }
  | { vmKey: string } // segment "conn:type:node:vmid"
  | { connection: string; vmidField: BodyOrQueryField } // vmid in body/query, any node/type

export type AllowlistEntry = {
  /** Stable id, carried by the internal x-pxc-entry header. */
  id: string
  method: HttpMethod
  /** Segment-per-segment pattern; {name} = one named dynamic segment. */
  pattern: string
  /** anyOf semantics; empty list = any valid token (health). */
  requiredScopes: string[]
  /** Name of the dynamic segment carrying a RAW connection id, if any (spec layer 1). */
  connectionSegment?: string
  /** Composite segment "conn:type:node:vmid"; the connection is its first field. */
  vmKeySegment?: string
  /** Connection id carried in the body or query string. */
  connectionField?: BodyOrQueryField
  /** The handler resolves the connection itself (pinned list). */
  perimeter?: "handler"
  /** Closed value set for a dynamic segment; keeps {action} from swallowing sibling literals. */
  segmentEnum?: Record<string, readonly string[]>
  /** Values a dynamic segment never takes: static sibling routes Next serves before it. */
  segmentExclude?: Record<string, readonly string[]>
  /** The ONE segment allowed to contain %2F (its decoded value is validated). */
  encodedSlashSegment?: string
  guestScope?: GuestScopeSpec
  clusterObject?: boolean
  secondaryConnections?: BodyOrQueryField[]
  /** Permission keys the handler may check beyond its scope. */
  secondaryPermissions?: string[]
  tag: ApiTag
  /** Route module, repo-frontend-relative; consumed by the contract tests. */
  routeFile: string
  summary: string
  description: string
  queryParams?: AllowlistQueryParam[]
  /** Key into REQUEST_SCHEMAS (openapiSchemas.ts), for entries with a body. */
  requestSchemaRef?: string
  /** Key into RESPONSE_SCHEMAS (openapiSchemas.ts). */
  responseSchemaRef: string
}

/** Path prefix of the routes keyed by a raw connection id. */
export const CONN = "/api/v1/connections/{id}"
