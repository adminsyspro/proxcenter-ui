// PURE data module: imported by BOTH the proxy (D7) and
// principal.ts (D8). NO DB access, ever.
// Single source of truth for: the proxy derogation, the authorization
// (getPrincipal step 10), the OpenAPI generation and the contract tests.
// One module per domain; this index assembles them and holds the matchers
// that read the whole list.
import { BACKUP_ENTRIES } from "./backups"
import { HA_ENTRIES } from "./ha"
import { _matchAgainst, matchEntryParams, type AllowlistMatch } from "./matcher"
import { MONITORING_ENTRIES } from "./monitoring"
import { NETWORK_ENTRIES } from "./network"
import { POOLS_ENTRIES } from "./pools"
import { STORAGE_ENTRIES } from "./storage"
import type { AllowlistEntry, HttpMethod } from "./types"
import { VM_ENTRIES } from "./vms"

export type {
  AllowlistEntry, AllowlistQueryParam, ApiTag, BodyOrQueryField, GuestScopeSpec, HttpMethod,
} from "./types"
export {
  _matchAgainst, isRejectedPath, isWriteEntry, matchEntryParams, matchesEntry, type AllowlistMatch,
} from "./matcher"

export const PUBLIC_API_ALLOWLIST: AllowlistEntry[] = [
  ...MONITORING_ENTRIES, ...VM_ENTRIES, ...BACKUP_ENTRIES, ...STORAGE_ENTRIES, ...HA_ENTRIES, ...POOLS_ENTRIES,
  ...NETWORK_ENTRIES,
]

const ENTRIES_BY_ID = new Map(PUBLIC_API_ALLOWLIST.map(e => [e.id, e]))

export function getAllowlistEntryById(id: string): AllowlistEntry | null {
  return ENTRIES_BY_ID.get(id) ?? null
}

/** THE single shared matcher: the proxy and getPrincipal both use it. */
export function matchPublicApiPath(pathname: string, method: string): AllowlistMatch {
  return _matchAgainst(PUBLIC_API_ALLOWLIST, pathname, method)
}

/** Methods an allowlisted path answers to (any method), for 405 handling. */
export function allowedMethodsForPath(pathname: string): HttpMethod[] {
  const methods: HttpMethod[] = []
  for (const entry of PUBLIC_API_ALLOWLIST) {
    if (!methods.includes(entry.method) && matchEntryParams(entry, pathname) !== null) methods.push(entry.method)
  }
  return methods
}

/** Value of the Allow header for a path: its entry methods, plus HEAD when GET is present. Empty string when unlisted. */
export function allowHeaderForPath(pathname: string): string {
  const methods: string[] = allowedMethodsForPath(pathname)
  return (methods.includes("GET") ? [...methods, "HEAD"] : methods).join(", ")
}
