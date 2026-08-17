// PURE module. A scope is a named bundle of EXISTING RBAC permission keys
// (spec section 7). The RBAC assignment scope vocabulary
// (global/connection/node/vm/tag/pool) is orthogonal and untouched.
//
// INVARIANT (#632): a scope may only bundle read permissions. Every key
// here must be non-dangerous in the seeded catalogue AND end in .view or
// .content — scopes.test.ts enforces both, so a future scope cannot quietly
// hand a token something write-capable. `compliance:read` used to violate
// this: it mapped to `admin.compliance`, the single permission guarding both
// the compliance reads and its five mutations. It was inert (no compliance
// path is in the allowlist, so the scope opened nothing at all) but it would
// have become a real escalation the day a compliance route was allowlisted.
// Removed rather than papered over; exposing compliance over the API needs a
// read-only permission to map to first.
export const SCOPE_DEFINITIONS: Record<string, readonly string[]> = {
  "vms:read": ["vm.view"],
  "nodes:read": ["node.view", "connection.view"],
  "storage:read": ["storage.view", "storage.content"],
  "backups:read": ["backup.view", "backup.job.view"],
  "automation:read": ["automation.view"],
  "alerts:read": ["alerts.view", "events.view"],
  "reports:read": ["reports.view"],
}

export const ALL_SCOPE_IDS = Object.keys(SCOPE_DEFINITIONS)

/** Unknown scopes contribute nothing (fail-closed). */
export function expandScopes(scopes: readonly string[]): Set<string> {
  const permissions = new Set<string>()
  for (const scope of scopes) {
    for (const permission of SCOPE_DEFINITIONS[scope] ?? []) permissions.add(permission)
  }
  return permissions
}
