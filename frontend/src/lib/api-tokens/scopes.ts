// PURE module. A scope is a named bundle of EXISTING RBAC permission keys
// (spec section 7). The RBAC assignment scope vocabulary
// (global/connection/node/vm/tag/pool) is orthogonal and untouched.
//
// INVARIANT (#632): the `:read` scopes may only bundle read permissions.
// Every key in READ_SCOPE_DEFINITIONS must be non-dangerous in the seeded
// catalogue AND end in .view or .content — scopes.test.ts enforces both, so a
// future read scope cannot quietly hand a token something write-capable.
// Write scopes (WRITE_SCOPE_DEFINITIONS) list their keys explicitly instead;
// the tests pin the exact tables and forbid admin.*, automation.*, console and
// NIC mac/vlan keys in them.
// `compliance:read` used to violate the read invariant: it mapped to
// `admin.compliance`, the single permission guarding both the compliance reads
// and its five mutations. It was inert (no compliance path is in the
// allowlist, so the scope opened nothing at all) but it would have become a
// real escalation the day a compliance route was allowlisted. Removed rather
// than papered over; exposing compliance over the API needs a read-only
// permission to map to first.
export const READ_SCOPE_DEFINITIONS: Record<string, readonly string[]> = {
  "vms:read": ["vm.view"],
  "nodes:read": ["node.view", "connection.view"],
  "storage:read": ["storage.view", "storage.content"],
  "backups:read": ["backup.view", "backup.job.view"],
  "automation:read": ["automation.view"],
  "alerts:read": ["alerts.view", "events.view"],
  "reports:read": ["reports.view"],
}

export const WRITE_SCOPE_DEFINITIONS: Record<string, readonly string[]> = {
  "vms:power": ["vm.view", "connection.view", "vm.start", "vm.stop", "vm.restart", "vm.suspend"],
  "vms:write": ["vm.view", "connection.view", "vm.create", "vm.clone", "vm.config"],
  "vms:snapshot": ["vm.view", "connection.view", "vm.snapshot"],
  "vms:migrate": ["vm.view", "connection.view", "vm.migrate"],
  "vms:delete": ["vm.view", "connection.view", "vm.delete"],
  "backups:write": [
    "backup.view",
    "connection.view",
    "backup.job.view",
    "backup.job.create",
    "backup.job.edit",
    "backup.job.delete",
    "backup.job.run",
    "vm.backup",
  ],
  "backups:restore": ["backup.view", "connection.view", "vm.backup", "backup.restore"],
  "backups:delete": ["backup.view", "connection.view", "backup.delete"],
  "storage:write": [
    "storage.view",
    "storage.content",
    "storage.upload",
    "storage.delete",
    "connection.view",
    "connection.manage",
    "backup.view",
  ],
  "ha:write": ["node.view", "connection.view", "node.manage", "connection.manage"],
  "pools:write": ["connection.view", "connection.manage"],
  "network:write": [
    "node.view",
    "connection.view",
    "node.network",
    "connection.manage",
    "sdn.vnet.view",
    "sdn.vnet.create",
    "sdn.vnet.edit",
    "sdn.vnet.delete",
  ],
  "firewall:write": ["node.view", "connection.view", "node.manage"],
}

export const SCOPE_DEFINITIONS: Record<string, readonly string[]> = {
  ...READ_SCOPE_DEFINITIONS,
  ...WRITE_SCOPE_DEFINITIONS,
}

export const READ_SCOPE_IDS = Object.keys(READ_SCOPE_DEFINITIONS)
export const WRITE_SCOPE_IDS = Object.keys(WRITE_SCOPE_DEFINITIONS)
export const ALL_SCOPE_IDS = Object.keys(SCOPE_DEFINITIONS)

/** Scopes that let a token destroy data; the UI asks for extra confirmation. */
export const DESTRUCTIVE_SCOPE_IDS: readonly string[] = ["vms:delete", "backups:delete"]

export function isWriteScope(id: string): boolean {
  return Object.hasOwn(WRITE_SCOPE_DEFINITIONS, id)
}

/** Unknown scopes contribute nothing (fail-closed). */
export function expandScopes(scopes: readonly string[]): Set<string> {
  const permissions = new Set<string>()
  for (const scope of scopes) {
    for (const permission of SCOPE_DEFINITIONS[scope] ?? []) permissions.add(permission)
  }
  return permissions
}
