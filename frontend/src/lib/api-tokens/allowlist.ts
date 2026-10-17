// PURE data module: imported by BOTH the proxy (D7) and
// principal.ts (D8). NO DB access, ever.
// Single source of truth for: the proxy derogation, the authorization
// (getPrincipal step 10), the OpenAPI generation and the contract tests.

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
  | { connection: string; node: string; type: string; vmid: string } // path segment names
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

export const PUBLIC_API_ALLOWLIST: AllowlistEntry[] = [
  {
    id: "vms-list",
    method: "GET",
    tag: "Monitoring",
    pattern: "/api/v1/vms",
    requiredScopes: ["vms:read"],
    routeFile: "src/app/api/v1/vms/route.ts",
    summary: "List all VMs and containers across visible connections",
    description:
      "Aggregated VM/LXC list with status, usage and config-derived fields (cpuType, scsihw, agentEnabled, bios, ostype, onboot, description, macs) served by default. `ips` merges the addresses pinned in the config with the last known guest agent / LXC addresses from a background index; `staleIps` lists the last known addresses a guest could not re-confirm (stopped, agent down) and `ipIndexWarming` tells that the index is still being built. Pass include=agent to probe the QEMU guest agent on running VMs (about 7x slower).",
    queryParams: [
      { name: "connId", description: "Restrict to a single connection id" },
      { name: "include", description: "Set to 'agent' to probe the guest agent on running VMs" },
    ],
    responseSchemaRef: "VmsResponse",
  },
  {
    id: "inventory-tree",
    method: "GET",
    tag: "Monitoring",
    pattern: "/api/v1/inventory",
    requiredScopes: ["nodes:read"],
    routeFile: "src/app/api/v1/inventory/route.ts",
    summary: "Multi-cluster inventory tree (clusters, nodes, guests, PBS)",
    description:
      "Full inventory tree served from the shared SWR cache, filtered by tenant, vDC and token connection perimeter.",
    queryParams: [{ name: "refresh", description: "Set to 'true' to force a blocking refresh" }],
    responseSchemaRef: "InventoryResponse",
  },
  {
    id: "storage-list",
    method: "GET",
    tag: "Monitoring",
    pattern: "/api/v1/storage",
    requiredScopes: ["storage:read"],
    routeFile: "src/app/api/v1/storage/route.ts",
    summary: "All storages across visible PVE connections",
    description: "Aggregated storage list with capacity and usage per storage.",
    responseSchemaRef: "StorageResponse",
  },
  {
    id: "pbs-backups",
    method: "GET",
    tag: "Monitoring",
    pattern: "/api/v1/pbs/{id}/backups",
    requiredScopes: ["backups:read"],
    connectionSegment: "id",
    routeFile: "src/app/api/v1/pbs/[id]/backups/route.ts",
    summary: "Snapshots of one PBS server",
    description:
      "All snapshots of the given PBS connection (all datastores and namespaces), paginated and filterable. {id} is a raw connection id, validated against the token perimeter before the handler runs.",
    queryParams: [
      { name: "datastore", description: "Filter by datastore name" },
      { name: "namespace", description: "Exact namespace ('' for root)" },
      { name: "type", description: "Filter by backup type: vm, ct or host" },
      { name: "page", description: "Page number (default 1)" },
      { name: "pageSize", description: "Page size (default 50)" },
      { name: "search", description: "Case-insensitive text search" },
    ],
    responseSchemaRef: "PbsBackupsResponse",
  },
  {
    id: "public-backups",
    method: "GET",
    tag: "Monitoring",
    pattern: "/api/v1/public/backups",
    requiredScopes: ["backups:read"],
    routeFile: "src/app/api/v1/public/backups/route.ts",
    summary: "Fleet-wide backup freshness per guest",
    description:
      "For every guest in the token perimeter: most recent backup date, age in seconds, datastore, PBS server, size and verification state. Guests without any backup are present with a null age.",
    responseSchemaRef: "PublicBackupsResponse",
  },
  {
    id: "public-metrics",
    method: "GET",
    tag: "Monitoring",
    pattern: "/api/v1/public/metrics",
    requiredScopes: ["nodes:read", "vms:read", "backups:read"],
    routeFile: "src/app/api/v1/public/metrics/route.ts",
    summary: "Prometheus exposition of fleet metrics",
    description:
      "Prometheus text exposition served from the inventory and PBS caches (never amplified to the hypervisor). Series families are filtered by scope: proxcenter_node_* needs nodes:read, proxcenter_vm_* needs vms:read, proxcenter_backup_* needs backups:read.",
    responseSchemaRef: "PrometheusExposition",
  },
  {
    id: "public-health",
    method: "GET",
    tag: "Monitoring",
    pattern: "/api/v1/public/health",
    requiredScopes: [],
    routeFile: "src/app/api/v1/public/health/route.ts",
    summary: "Application status and per-connection reachability",
    description:
      "Authenticated variant of the public liveness probe: application status plus per-connection reachability derived from the inventory cache, filtered by tenant. Any valid token can call it.",
    responseSchemaRef: "HealthResponse",
  },
]

const ENTRIES_BY_ID = new Map(PUBLIC_API_ALLOWLIST.map(e => [e.id, e]))

export function getAllowlistEntryById(id: string): AllowlistEntry | null {
  return ENTRIES_BY_ID.get(id) ?? null
}

/**
 * Structural pre-match rejections (spec section 8): empty segment (double
 * slash), '.' or '..' segments, trailing slash on a non-root path.
 */
function hasStructuralRejection(pathname: string): boolean {
  if (pathname !== "/" && pathname.endsWith("/")) return true
  const segments = pathname.split("/").slice(1)
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") return true
  }
  return false
}

function hasEncodedSlash(value: string): boolean {
  const lower = value.toLowerCase()
  return lower.includes("%2f") || lower.includes("%5c")
}

/**
 * Pre-match rejections: the structural ones plus an encoded slash or
 * backslash anywhere. Only an entry declaring encodedSlashSegment lifts the
 * latter, for that one segment (see matchPattern). Rejection = no match = the
 * existing proxy cookie 401, nothing is disclosed.
 */
export function isRejectedPath(pathname: string): boolean {
  return hasEncodedSlash(pathname) || hasStructuralRejection(pathname)
}

/** Decoded value of the encodedSlashSegment: no backslash, no empty/'.'/'..' sub-segment. */
function isSafeEncodedSlashValue(raw: string): boolean {
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return false
  }
  if (decoded.includes("\\")) return false
  return !decoded.split("/").some(part => part === "" || part === "." || part === "..")
}

function matchPattern(entry: AllowlistEntry, pathname: string): Record<string, string> | null {
  if (hasStructuralRejection(pathname)) return null
  const patternSegments = entry.pattern.split("/").slice(1)
  const pathSegments = pathname.split("/").slice(1)
  if (patternSegments.length !== pathSegments.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < patternSegments.length; i++) {
    const p = patternSegments[i]
    const value = pathSegments[i]
    const isDynamic = p.startsWith("{") && p.endsWith("}")
    const name = isDynamic ? p.slice(1, -1) : null
    if (hasEncodedSlash(value)) {
      if (name === null || name !== entry.encodedSlashSegment || !isSafeEncodedSlashValue(value)) return null
    }
    if (name !== null) {
      const allowed = entry.segmentEnum?.[name]
      if (allowed && !allowed.includes(value)) return null
      params[name] = value
    } else if (p !== value) {
      return null
    }
  }
  return params
}

export type AllowlistMatch = { ok: boolean; entryId?: string; params?: Record<string, string> }

/** HEAD is served by the GET entry. */
function effectiveMethod(method: string): string {
  return method === "HEAD" ? "GET" : method
}

/** Matcher core, exported for tests that inject synthetic entries. */
export function _matchAgainst(entries: AllowlistEntry[], pathname: string, method: string): AllowlistMatch {
  const wanted = effectiveMethod(method)
  for (const entry of entries) {
    if (entry.method !== wanted) continue
    const params = matchPattern(entry, pathname)
    if (params !== null) return { ok: true, entryId: entry.id, params }
  }
  return { ok: false }
}

/** THE single shared matcher: the proxy and getPrincipal both use it. */
export function matchPublicApiPath(pathname: string, method: string): AllowlistMatch {
  return _matchAgainst(PUBLIC_API_ALLOWLIST, pathname, method)
}

/** Methods an allowlisted path answers to (any method), for 405 handling. */
export function allowedMethodsForPath(pathname: string): HttpMethod[] {
  const methods: HttpMethod[] = []
  for (const entry of PUBLIC_API_ALLOWLIST) {
    if (!methods.includes(entry.method) && matchPattern(entry, pathname) !== null) methods.push(entry.method)
  }
  return methods
}

/** Value of the Allow header for a path: its entry methods, plus HEAD when GET is present. Empty string when unlisted. */
export function allowHeaderForPath(pathname: string): string {
  const methods: string[] = allowedMethodsForPath(pathname)
  return (methods.includes("GET") ? [...methods, "HEAD"] : methods).join(", ")
}

/** Re-verification against ONE designated entry (getPrincipal step 10): never a free re-match. */
export function matchEntryParams(entry: AllowlistEntry, pathname: string): Record<string, string> | null {
  return matchPattern(entry, pathname)
}

export function matchesEntry(entry: AllowlistEntry, pathname: string, method: string): boolean {
  return entry.method === effectiveMethod(method) && matchPattern(entry, pathname) !== null
}

export function isWriteEntry(entry: AllowlistEntry): boolean {
  return entry.method !== "GET"
}
