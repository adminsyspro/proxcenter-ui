// PURE module. A scope is a named bundle of EXISTING RBAC permission keys
// (spec section 7). The RBAC assignment scope vocabulary
// (global/connection/node/vm/tag/pool) is orthogonal and untouched.
//
// INVARIANT (#632): the `:read` scopes may only bundle read permissions.
// Every key in READ_SCOPE_DEFINITIONS must be non-dangerous in the seeded
// catalogue AND end in .view or .content — scopes.test.ts enforces both, so a
// future read scope cannot quietly hand a token something write-capable.
// Write scopes (WRITE_SCOPE_DEFINITIONS) list their keys explicitly instead;
// the tests pin the exact tables and forbid automation.*, console and NIC
// mac/vlan keys in them, and admin.* outside ADMIN_WRITE_SCOPE_IDS.
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
  // Multi-tenant layer (issue #1360). The admin reads map the read-only
  // children of the admin rights, never the admin rights themselves.
  "tenants:read": ["admin.tenants.view"],
  "vdcs:read": ["admin.settings.view", "vm.view", "sdn.vnet.view"],
  "ipam:read": ["sdn.vnet.view"],
  "rbac:read": ["admin.rbac.view"],
  "users:read": ["admin.users.view"],
}

/**
 * Read scopes whose creator must hold every key, at creation and on each
 * call, exactly like a write scope: they read administration data (users,
 * roles, tenants, provider settings, vDC networks) that holding
 * admin.apitokens alone does not show. The older read scopes keep their
 * historical rule.
 */
export const CREATOR_CHECKED_READ_SCOPE_IDS: readonly string[] = ["tenants:read", "vdcs:read", "ipam:read", "rbac:read", "users:read"]

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
  // Provider administration (issue #1360): the only write scope with admin
  // keys, both narrow children of admin.settings that need a global grant,
  // on routes that answer the provider tenant only.
  "vdcs:write": ["admin.settings.view", "admin.settings.vdcs", "vm.view", "sdn.vnet.view"],
  // Tenants, users and role assignments (issue #1360). Each carries the admin
  // right of its own domain and nothing else. A token never acts as a super
  // admin: roles themselves, protected accounts and protected roles stay out
  // of its reach whatever its scopes.
  "tenants:write": ["admin.tenants.view", "admin.tenants"],
  "users:write": ["admin.users.view", "admin.users"],
  "rbac:write": ["admin.rbac.view", "admin.rbac"],
}

export const SCOPE_DEFINITIONS: Record<string, readonly string[]> = {
  ...READ_SCOPE_DEFINITIONS,
  ...WRITE_SCOPE_DEFINITIONS,
}

export const READ_SCOPE_IDS = Object.keys(READ_SCOPE_DEFINITIONS)
export const WRITE_SCOPE_IDS = Object.keys(WRITE_SCOPE_DEFINITIONS)
export const ALL_SCOPE_IDS = Object.keys(SCOPE_DEFINITIONS)

/**
 * Write scopes carrying an admin right, which only counts when granted
 * globally. They read back what they manage.
 */
export const ADMIN_WRITE_SCOPE_IDS: readonly string[] = ["vdcs:write", "tenants:write", "users:write", "rbac:write"]

/**
 * Write scopes no connection perimeter can hold: vDC operations reach
 * clusters beyond any one connection (fleet-wide VNI scan, stretched
 * networks, PBS storages), and tenants, users and role assignments belong to
 * no connection at all. A token restricted to connections cannot carry them
 * (issue #1360).
 */
export const FLEET_SCOPE_IDS: readonly string[] = ADMIN_WRITE_SCOPE_IDS

/** Scopes that let a token destroy data; the UI asks for extra confirmation. */
export const DESTRUCTIVE_SCOPE_IDS: readonly string[] = ["vms:delete", "backups:delete"]

export function isWriteScope(id: string): boolean {
  return Object.hasOwn(WRITE_SCOPE_DEFINITIONS, id)
}

/**
 * Scopes that read administration data: the admin read scopes and the admin
 * write scopes, which read back what they manage. A read relying on one of
 * them checks the creator's rights again on every call, write scope or not.
 */
export function readsAdminData(id: string): boolean {
  return CREATOR_CHECKED_READ_SCOPE_IDS.includes(id) || ADMIN_WRITE_SCOPE_IDS.includes(id)
}

/** Scopes the creator must hold: every write scope and the admin read scopes. */
export function isCreatorCheckedScope(id: string): boolean {
  return isWriteScope(id) || CREATOR_CHECKED_READ_SCOPE_IDS.includes(id)
}

/** Unknown scopes contribute nothing (fail-closed). */
export function expandScopes(scopes: readonly string[]): Set<string> {
  const permissions = new Set<string>()
  for (const scope of scopes) {
    for (const permission of SCOPE_DEFINITIONS[scope] ?? []) permissions.add(permission)
  }
  return permissions
}
