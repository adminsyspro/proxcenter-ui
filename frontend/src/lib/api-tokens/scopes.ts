// PURE module. A scope is a named bundle of EXISTING RBAC permission keys
// (spec section 7). The RBAC assignment scope vocabulary
// (global/connection/node/vm/tag/pool) is orthogonal and untouched.
export const SCOPE_DEFINITIONS: Record<string, readonly string[]> = {
  "vms:read": ["vm.view"],
  "nodes:read": ["node.view", "connection.view"],
  "storage:read": ["storage.view", "storage.content"],
  "backups:read": ["backup.view", "backup.job.view"],
  "automation:read": ["automation.view"],
  "alerts:read": ["alerts.view", "events.view"],
  "reports:read": ["reports.view"],
  "compliance:read": ["admin.compliance"],
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
